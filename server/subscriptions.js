import { z } from "zod";

// Subscriptions: found in card charges and bank auto-debits, confirmed by the user, plus ones added by hand
// (paid somewhere the app can't see). Everything here is computed from data; no model involved.

const DAY = 86_400_000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const addMonths = (date, n) => {
  const d = new Date(date + "T00:00:00Z"),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
};
export const CYCLES = { week: 7, month: 30.44, quarter: 91.3, year: 365.25 };
export const nextFrom = (date, cycle) =>
  cycle === "week" ? addDays(date, 7) : cycle === "quarter" ? addMonths(date, 3) : cycle === "year" ? addMonths(date, 12) : addMonths(date, 1);
// Well-known services: recognised even after a single charge, with the page where they're managed.
const KNOWN = [
  [/netflix|넷플릭스/i, "넷플릭스", "https://www.netflix.com/account"],
  [/youtube|유튜브/i, "유튜브 프리미엄", "https://www.youtube.com/paid_memberships"],
  [/spotify|스포티파이/i, "스포티파이", "https://www.spotify.com/account/subscription/"],
  [/apple\.com\/bill|애플.*(뮤직|원|tv|아케이드)|icloud/i, "Apple 구독", "https://apps.apple.com/account/subscriptions"],
  [/google\s*\*|google play|구글플레이/i, "Google Play 구독", "https://play.google.com/store/account/subscriptions"],
  [/claude/i, "Claude", "https://claude.ai/settings/billing"],
  [/anthropic/i, "Anthropic API", "https://console.anthropic.com/settings/billing"],
  [/chatgpt|openai/i, "ChatGPT", ""],
  [/disney|디즈니/i, "디즈니+", ""],
  [/티빙|tving/i, "티빙", ""],
  [/웨이브|wavve/i, "웨이브", ""],
  [/왓챠|watcha/i, "왓챠", ""],
  [/쿠팡.*(와우|wow)|wow.*멤버/i, "쿠팡 와우", ""],
  [/네이버\s*플러스|네이버플러스/i, "네이버플러스 멤버십", ""],
  [/밀리의서재|리디|ridi/i, "전자책 구독", ""],
  [/adobe|어도비/i, "Adobe", ""],
  [/microsoft|마이크로소프트|xbox/i, "Microsoft", ""],
  [/notion|github|figma|dropbox|canva/i, "", ""],
];
const known = (merchant) => KNOWN.find(([re]) => re.test(merchant));
// Card charges in KRW for services billed in dollars move with the exchange rate.
const foreignName = (merchant) => /^[\x20-\x7E]+$/.test(merchant) && /[A-Za-z]/.test(merchant);
const cycleOf = (gap) =>
  gap >= 5 && gap <= 9 ? "week" : gap >= 25 && gap <= 35 ? "month" : gap >= 84 && gap <= 98 ? "quarter" : gap >= 350 && gap <= 380 ? "year" : null;
// Repeating charges alone don't make a subscription at a restaurant, a market, a taxi or a shop.
const EVERYDAY = new Set(["dining", "grocery", "alcohol", "transport", "shopping"]);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export const subscriptionSettingsSchema = z
  .object({
    // detected key → true (it's a subscription) / false (it isn't)
    decisions: z.record(z.string(), z.boolean()).default({}),
    overrides: z
      .record(
        z.string(),
        z
          .object({
            name: z.string().trim().max(60).optional(),
            cycle: z.enum(["week", "month", "quarter", "year"]).optional(),
            remind: z.boolean().optional(),
            manageUrl: z.string().trim().max(500).optional(),
          })
          .strict(),
      )
      .default({}),
    manual: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().trim().min(1).max(60),
            amount: z.number().int().min(0).max(100_000_000),
            cycle: z.enum(["week", "month", "quarter", "year"]),
            nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            paidWith: z.string().trim().max(60).default(""),
            manageUrl: z.string().trim().max(500).default(""),
            remind: z.boolean().default(true),
          })
          .strict(),
      )
      .default([]),
    reminded: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export const manualSubscriptionSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    amount: z.number().int().min(0).max(100_000_000),
    cycle: z.enum(["week", "month", "quarter", "year"]),
    nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paidWith: z.string().trim().max(60).default(""),
    manageUrl: z.union([z.literal(""), z.string().trim().url().max(500).startsWith("https://")]).default(""),
    remind: z.boolean().default(true),
  })
  .strict();

// One charge per day per payee: the same payment seen twice (two sources, a re-quoted FX amount) counts once.
function chargesOf(rows) {
  const byDate = new Map();
  for (const t of rows) if (!byDate.has(t.date)) byDate.set(t.date, t);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Service identity across card merchants and mail senders: "ANTHROPIC* CLAUDE SUB" and a Claude receipt are one.
const canonical = (name) => ((known(name || "")?.[1] || name || "").toLowerCase().replace(/[\s·.+]/g, ""));

export function findSubscriptions(state, today, settings = subscriptionSettingsSchema.parse({}), mail = null) {
  const s = subscriptionSettingsSchema.parse(settings);
  const groups = new Map();
  for (const t of state.transactions || [])
    if (!t.duplicate && !["cancelled", "rejected"].includes(t.status)) {
      const key = "card:" + t.merchant;
      (groups.get(key) || groups.set(key, { source: "card", merchant: t.merchant, category: t.category, rows: [] }).get(key)).rows.push(t);
    }
  // bank: only standing orders (CMS, auto-debit), never ordinary transfers such as rent to a person
  for (const t of state.bankTransactions || [])
    if (t.direction === "out" && /CMS|자동이체|정기|구독/i.test(t.description || "")) {
      const key = "bank:" + t.description;
      (groups.get(key) || groups.set(key, { source: "bank", merchant: t.description, category: "", rows: [] }).get(key)).rows.push(t);
    }
  const items = [];
  for (const [key, g] of groups) {
    const charges = chargesOf(g.rows),
      amounts = charges.map((c) => c.amount),
      gaps = charges.slice(1).map((c, i) => days(charges[i].date, c.date)),
      gap = median(gaps),
      cycle = s.overrides[key]?.cycle || (gaps.length ? cycleOf(gap) : null),
      foreign = foreignName(g.merchant),
      within = (xs) => !xs.length || Math.max(...xs) <= Math.min(...xs) * (foreign ? 1.2 : 1.05),
      // steady, or steady on both sides of one price change (a plan that got dearer is still a subscription)
      steady = amounts.length > 0 && amounts.some((_, i) => within(amounts.slice(0, i)) && within(amounts.slice(i))),
      service = known(g.merchant),
      // a merchant already confirmed as a fixed cost counts as a confirmed subscription until said otherwise
      decision = s.decisions[key] ?? (g.source === "card" && state.recurring?.[g.merchant] === true ? true : undefined);
    const regular =
      charges.length >= 3 &&
      !!cycle &&
      steady &&
      gaps.every((x) => cycleOf(x) === cycleOf(gap)) &&
      !EVERYDAY.has(g.category) &&
      (cycle !== "week" || g.category === "subscription");
    const likely = regular || g.category === "subscription" || !!service;
    if (!likely && decision !== true) continue;
    if (decision === false) continue;
    const last = charges.at(-1),
      c = cycle || "month",
      next = nextFrom(last.date, c),
      prev = charges.at(-2),
      flags = [];
    if (prev && !foreign && last.amount !== prev.amount) flags.push(last.amount > prev.amount ? "price-up" : "price-down");
    if (foreign && new Set(amounts).size > 1) flags.push("fx");
    // two separate charges in one month on a monthly plan: a double charge or a plan change
    const months = charges.filter((x) => x.date.slice(0, 7) === last.date.slice(0, 7));
    if (c === "month" && months.length > 1) flags.push("double");
    // "stopped" needs a known rhythm: one charge alone says nothing about when the next is due
    if (!s.overrides[key]?.cycle && !gaps.length) flags.push("cycle-unknown");
    else if (days(next, today) > 10) flags.push("stopped");
    items.push({
      key,
      source: g.source,
      merchant: g.merchant,
      name: s.overrides[key]?.name || service?.[1] || g.merchant,
      category: g.category,
      amount: last.amount,
      cycle: c,
      cycleGuessed: !cycle,
      lastDate: last.date,
      nextDate: next,
      charges: charges.slice(-6).map(({ date, amount }) => ({ date, amount })),
      monthly: Math.round((last.amount * CYCLES.month) / CYCLES[c]),
      flags,
      confirmed: decision === true,
      remind: s.overrides[key]?.remind ?? c !== "month",
      manageUrl: s.overrides[key]?.manageUrl || service?.[2] || "",
      previous: prev?.amount ?? null,
    });
  }
  for (const m of s.manual) {
    // roll a hand-entered date forward past today so "next" stays next
    let next = m.nextDate;
    for (let i = 0; i < 120 && next < today; i++) next = nextFrom(next, m.cycle);
    items.push({
      key: "manual:" + m.id,
      id: m.id,
      source: "manual",
      merchant: "",
      name: m.name,
      category: "subscription",
      amount: m.amount,
      cycle: m.cycle,
      cycleGuessed: false,
      lastDate: null,
      nextDate: next,
      charges: [],
      monthly: Math.round((m.amount * CYCLES.month) / CYCLES[m.cycle]),
      flags: [],
      confirmed: true,
      remind: m.remind,
      manageUrl: m.manageUrl,
      paidWith: m.paidWith,
      previous: null,
    });
  }
  // ---- cross-check with the mailbox ----
  const usd = state.investments?.fx?.fx || 0;
  for (const m of mail?.services || []) {
    const id = canonical(m.service),
      hit = items.find((i) => i.source !== "manual" && (canonical(i.name) === id || canonical(i.merchant) === id));
    if (hit) {
      hit.mail = { status: m.status, lastDate: m.lastDate, cancelDate: m.cancelDate, priceNotice: m.priceNotice, trialDate: m.trialDate, evidence: m.evidence };
      hit.flags.push("mail");
      // cancelled by mail but the card kept being charged: the one to act on
      // a charge within a cycle of the cancellation shouldn't have happened; charges that restart later are a new subscription
      const after = m.cancelDate && hit.charges.find((x) => x.date > m.cancelDate);
      if (after && days(m.cancelDate, after.date) <= CYCLES[hit.cycle] + 10) hit.flags.push("charged-after-cancel");
      else if (m.status === "cancelled" && !after) hit.flags.push("cancelled-by-mail");
      if (m.priceNotice && days(m.priceNotice, today) <= 90) hit.flags.push("price-notice");
      continue;
    }
    // In the mailbox but not in any connected card or account: paid some other way (app store, another card, phone bill).
    const key = "mail:" + m.service,
      decision = s.decisions[key];
    // only a service actually paid recently is a subscription; trial, sign-up or cancellation mail alone is not
    if (decision === false || ((m.status === "cancelled" || !m.lastPaid) && decision !== true)) continue;
    const paid = m.paid || [],
      gaps = paid.slice(1).map((p, i) => days(paid[i].date, p.date)),
      cycle = s.overrides[key]?.cycle || (gaps.length ? cycleOf(median(gaps)) : null),
      c = cycle || "month",
      last = m.lastPaid,
      krw = last ? (last.currency === "USD" ? Math.round(last.amount * (usd || 1400)) : last.amount) : 0,
      next = last ? nextFrom(last.date, c) : m.lastDate,
      overdue = days(next, today);
    // no mail for a whole cycle past the due date: it ended long ago, unless the user said it's live
    if (overdue > CYCLES[c] && decision !== true) continue;
    items.push({
      key,
      source: "mail",
      merchant: "",
      name: s.overrides[key]?.name || m.service,
      category: "subscription",
      amount: krw,
      original: last && last.currency === "USD" ? { amount: last.amount, currency: "USD", approx: !usd } : null,
      cycle: c,
      cycleGuessed: !cycle,
      lastDate: last?.date || m.lastDate,
      nextDate: next,
      charges: paid.map((p) => ({ date: p.date, amount: p.amount })),
      monthly: Math.round((krw * CYCLES.month) / CYCLES[c]),
      flags: ["mail-only", ...(m.status === "trial" ? ["trial"] : []), ...(!last ? ["no-amount"] : []), ...(overdue > 10 ? ["stopped"] : [])],
      confirmed: decision === true,
      remind: s.overrides[key]?.remind ?? true,
      manageUrl: s.overrides[key]?.manageUrl || known(m.service)?.[2] || "",
      mail: { status: m.status, lastDate: m.lastDate, cancelDate: m.cancelDate, priceNotice: m.priceNotice, trialDate: m.trialDate, evidence: m.evidence },
      previous: null,
    });
  }
  items.sort((a, b) => (b.confirmed - a.confirmed) || a.nextDate.localeCompare(b.nextDate));
  const counted = items.filter((i) => i.confirmed && !i.flags.includes("stopped"));
  const monthly = counted.reduce((sum, i) => sum + i.monthly, 0);
  return {
    items,
    summary: {
      monthly,
      yearly: Math.round((monthly * 365.25) / CYCLES.month),
      count: counted.length,
      toReview: items.filter((i) => !i.confirmed).length,
      upcoming: counted.filter((i) => i.nextDate >= today && days(today, i.nextDate) <= 7).map((i) => i.key),
      mail: mail ? { at: mail.at, read: mail.read, services: mail.services.length, errors: mail.errors || [] } : null,
    },
  };
}

// Reminders due today: a few days before each subscription whose reminder is on, once per charge date.
export function dueReminders(found, today, reminded = {}, lead = 3) {
  return found.items.filter(
    (i) => i.confirmed && i.remind && !i.flags.includes("stopped") && days(today, i.nextDate) >= 0 && days(today, i.nextDate) <= lead && reminded[i.key] !== i.nextDate,
  );
}
