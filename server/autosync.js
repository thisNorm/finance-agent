import { z } from "zod";
import { currentDate } from "./finance.js";

// Pull every `intervalHours` while the clock is inside [fromHour, toHour] (Asia/Seoul). Wrap-around windows (22→6) are fine.
export const autoSyncSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    intervalHours: z.number().int().min(1).max(24).default(6),
    fromHour: z.number().int().min(0).max(23).default(7),
    toHour: z.number().int().min(0).max(23).default(23),
  })
  .strict();
export const AUTOSYNC_KEY = "setting:autoSync";
const seoulHour = (now) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(now)) % 24;
export const inWindow = (hour, from, to) => (from <= to ? hour >= from && hour <= to : hour >= from || hour <= to);
export const describeAutoSync = (s) =>
  !s.enabled
    ? "자동 수집 꺼짐"
    : `${String(s.fromHour).padStart(2, "0")}시~${String(s.toHour).padStart(2, "0")}시 사이 ${s.intervalHours}시간마다 자동 수집`;
// Last three months, from the 1st: enough for recurring-cost detection, small enough for CODEF quotas.
export function syncWindow(today = currentDate()) {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - 3, 1);
  return { from: d.toISOString().slice(0, 10), to: today };
}
// Pulls bank + card data on a schedule so the user never has to press sync. Runs only when a connection is ready.
export function createAutoSync({ store, bank, toss = null, notifier = null, afterSync = () => {} }) {
  const settings = () => autoSyncSettingsSchema.parse(store.getSetting("autoSync", {}));
  const last = () => store.getSetting("autoSyncLast", null);
  let running = false;
  async function run(reason = "manual") {
    if (running) return last();
    const ready = { bank: !!bank.status().ready, card: !!bank.cardStatus().ready, toss: !!toss?.status().ready };
    if (!ready.bank && !ready.card && !ready.toss) return last();
    running = true;
    const window = syncWindow(),
      result = { at: new Date().toISOString(), reason, synced: [], errors: [] };
    try {
      for (const [kind, ok, pull, save] of [
        ["bank", ready.bank, () => bank.sync(window), store.saveBankSync],
        ["card", ready.card, () => bank.syncCard(window), store.saveCardSync],
        ["toss", ready.toss, () => toss.sync(), store.saveInvestments],
      ]) {
        if (!ok) continue;
        try {
          save(await pull());
          result.synced.push(kind);
        } catch (e) {
          const en = store.getSetting("lang") === "en";
          result.errors.push(
            `${{ bank: en ? "Bank" : "계좌", card: en ? "Card" : "카드", toss: en ? "Toss Securities" : "토스증권" }[kind]}: ${
              e.name === "ZodError"
                ? en
                  ? "The data came back in an unexpected shape, so nothing was saved."
                  : "받은 자료 형식이 예상과 달라 저장하지 않았습니다."
                : e.message
            }`,
          );
        }
      }
      const errors = result.errors.join("\n"),
        alreadyNotified = last()?.notifiedErrors === errors;
      store.setSetting("autoSyncLast", { ...result, notifiedErrors: errors || undefined });
      if (result.synced.length) afterSync();
      if (errors && !alreadyNotified)
        notifier
          ?.send(
            store.getSetting("lang") === "en" ? "Alaseo \u00b7 auto sync failed" : "알아서 \u00b7 자동 수집 실패",
            errors,
          )
          .catch(() => {});
      return result;
    } finally {
      running = false;
    }
  }
  // Called every minute. Runs when inside the window and the last pull is at least intervalHours old (never ran → now).
  function tick(now = new Date()) {
    const s = settings();
    if (!s.enabled || !inWindow(seoulHour(now), s.fromHour, s.toHour)) return false;
    const prev = last(),
      due = !prev || now.getTime() - Date.parse(prev.at) >= s.intervalHours * 3600_000 - 30_000;
    if (!due) return false;
    // A scheduled pull must never take the server down with it.
    run("scheduled").catch(() => {});
    return true;
  }
  return {
    settings,
    configure: (input) => {
      const s = autoSyncSettingsSchema.parse(input);
      store.setSetting("autoSync", s);
      return s;
    },
    last,
    run,
    tick,
  };
}
