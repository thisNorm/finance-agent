import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import {
  category,
  money,
  monthSchema,
  makePlan,
  profileSchema,
  preferenceSchema,
  purchaseGoalSchema,
  httpsUrlSchema,
  withInstallment,
  installmentMonths,
  installmentTerms,
} from "./finance.js";
import { autoSyncSettingsSchema } from "./autosync.js";
import { notificationSettingsSchema } from "./notify.js";
import { autoInvestSchema, dcaSchema } from "./invest.js";
import { findSubscriptions, subscriptionSettingsSchema, CYCLES } from "./subscriptions.js";
const operation = z.enum(["set", "increase", "decrease"]);
export const changesSchema = z
  .array(
    z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("preference"),
          category,
          amount: money,
          operation,
          month: z.union([monthSchema, z.literal("always")]),
          note: z.string().max(300),
        })
        .strict(),
      z
        .object({
          type: z.literal("profile"),
          field: z.enum([
            "income",
            "annualGross",
            "balance",
            "payday",
            "savings",
            "reserve",
            "debt",
            "cardDueDay",
            "interestFreeMonths",
            "installmentRate",
          ]),
          amount: money,
          operation,
        })
        .strict(),
      z
        .object({
          type: z.literal("protect"),
          field: z.enum(["savingsLocked", "reserveLocked"]),
          enabled: z.boolean(),
        })
        .strict(),
      z
        .object({
          type: z.literal("category"),
          merchant: z.string().min(1).max(200),
          category,
        })
        .strict(),
      z
        .object({
          type: z.literal("recurring"),
          merchant: z.string().min(1).max(200),
          confirmed: z.boolean(),
        })
        .strict(),
      z
        .object({
          type: z.literal("installment"),
          merchant: z.string().min(1).max(200),
          months: installmentMonths,
        })
        .strict(),
      z
        .object({
          type: z.literal("remove_goal"),
          id: z.uuid(),
        })
        .strict(),
      // Patch shapes: only the fields the user mentioned, no defaults, so the rest of the setting survives.
      z
        .object({
          type: z.literal("autosync"),
          enabled: z.boolean().optional(),
          intervalHours: z.number().int().min(1).max(24).optional(),
          fromHour: z.number().int().min(0).max(23).optional(),
          toHour: z.number().int().min(0).max(23).optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("subscription"),
          name: z.string().trim().min(1).max(60),
          confirmed: z.boolean().optional(),
          remove: z.boolean().optional(),
          amount: z.number().int().min(0).max(100_000_000).optional(),
          cycle: z.enum(["week", "month", "quarter", "year"]).optional(),
          nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          remind: z.boolean().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("dca"),
          symbol: z.string().trim().regex(/^[A-Za-z0-9.-]{1,12}$/),
          amount: z.number().int().min(1000).max(100_000_000).optional(),
          every: z.enum(["day", "week", "month"]).optional(),
          day: z.union([z.literal("payday"), z.number().int().min(1).max(28)]).optional(),
          weekday: z.number().int().min(1).max(5).optional(),
          enabled: z.boolean().optional(),
          remove: z.boolean().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("autoinvest"),
          enabled: z.boolean().optional(),
          live: z.boolean().optional(),
          principal: z.number().int().min(0).max(1_000_000_000).optional(),
          lossLimitPct: z.number().int().min(1).max(90).optional(),
          intervalMinutes: z.number().int().min(15).max(1440).optional(),
          maxOrdersPerDay: z.number().int().min(1).max(50).optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("notifications"),
          desktop: z.boolean().optional(),
          ntfyTopic: z.string().trim().max(64).regex(/^[A-Za-z0-9_-]*$/).optional(),
          ntfyServer: z.string().trim().url().max(200).or(z.literal("")).optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("remove_preference"),
          category,
          month: z.union([monthSchema, z.literal("always")]),
        })
        .strict(),
      z
        .object({
          type: z.literal("goal"),
          id: z.union([z.uuid(), z.literal("")]),
          name: z.string().trim().min(1).max(120),
          productUrl: httpsUrlSchema,
          imageUrl: httpsUrlSchema,
          price: money.refine((value) => value > 0),
          saved: money,
          note: z.string().trim().max(300),
        })
        .strict(),
    ]),
  )
  .min(1)
  .max(12);
export const replySchema = z
  .object({
    answer: z.string().min(1).max(12000),
    changes: changesSchema.nullable(),
  })
  .strict();
export const stateHash = (s) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");
const applyAmount = (base, c) =>
  money.parse(
    c.operation === "set"
      ? c.amount
      : c.operation === "increase"
        ? base + c.amount
        : base - c.amount,
  );
export function previewChanges(state, changes, month) {
  changes = changesSchema.parse(changes);
  monthSchema.parse(month);
  const next = structuredClone(state),
    before = makePlan(state, month);
  for (const c of changes) {
    if (c.type === "profile") {
      if (!next.profile && !["income", "annualGross"].includes(c.field))
        throw Error("소득을 먼저 알려주세요.");
      next.profile ??= {
        income: 0,
        annualGross: 0,
        balance: 0,
        payday: null,
        savings: null,
        reserve: null,
        debt: 0,
        savingsLocked: false,
        reserveLocked: false,
        cardDueDay: null,
        interestFreeMonths: 3,
        installmentRate: 15,
      };
      const plan = makePlan(next, month);
      const base =
        next.profile[c.field] ??
        (c.field === "savings" ? plan.targetSavings : plan.targetReserve);
      if (c.operation !== "set" && base === undefined)
        throw Error("변경 기준 금액이 없습니다. 원하는 총액을 알려주세요.");
      next.profile[c.field] = applyAmount(base, c);
      next.profile = profileSchema.parse(next.profile);
    } else if (c.type === "protect") {
      if (!next.profile) throw Error("소득을 먼저 알려주세요.");
      // Freeze the currently allocated amount, not a larger unachieved target.
      const key = c.field === "savingsLocked" ? "savings" : "reserve";
      const plan = makePlan(next, month);
      if (c.enabled && !next.profile[c.field] && plan.ready)
        next.profile[key] = plan[key];
      next.profile[c.field] = c.enabled;
    } else if (c.type === "remove_preference") {
      next.preferences = next.preferences.filter(
        (p) => !(p.category === c.category && p.month === c.month),
      );
    } else if (c.type === "preference") {
      const plan = makePlan(next, c.month === "always" ? month : c.month);
      const existing = next.preferences.find(
        (p) => p.category === c.category && p.month === c.month,
      );
      const row = plan.ready
        ? plan.allocations.find((a) => a.category === c.category)
        : undefined;
      const fallback = row ? row.amount + row.fixedBudget : undefined;
      if (c.operation !== "set" && !existing && fallback === undefined)
        throw Error(
          "이 항목의 기준 예산이 없습니다. 원하는 총액을 알려주세요.",
        );
      const p = preferenceSchema.parse({
        category: c.category,
        amount: applyAmount(existing?.amount ?? fallback, c),
        month: c.month,
        note: c.note,
      });
      next.preferences = [
        ...next.preferences.filter(
          (x) => !(x.category === p.category && x.month === p.month),
        ),
        p,
      ];
    } else if (c.type === "remove_goal") {
      if (!next.goals.some((g) => g.id === c.id))
        throw Error("삭제할 구매 목표를 찾지 못했습니다.");
      next.goals = next.goals.filter((g) => g.id !== c.id);
    } else if (c.type === "autosync") {
      const { type, ...patch } = c;
      next["setting:autoSync"] = autoSyncSettingsSchema.parse({
        ...autoSyncSettingsSchema.parse(next["setting:autoSync"] || {}),
        ...patch,
      });
    } else if (c.type === "subscription") {
      // Match by name against what's listed (found or added by hand); otherwise it's a new hand-added one.
      const s = subscriptionSettingsSchema.parse(next["setting:subscriptions"] || {}),
        today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
        want = c.name.toLowerCase().replace(/\s+/g, ""),
        norm = (x) => (x || "").toLowerCase().replace(/\s+/g, ""),
        listed = findSubscriptions(next, today, s).items,
        hit = listed.find((i) => norm(i.name) === want || norm(i.merchant) === want) || listed.find((i) => norm(i.name).includes(want) || norm(i.merchant).includes(want));
      if (hit?.source === "manual") {
        const m = s.manual.find((x) => "manual:" + x.id === hit.key);
        if (c.remove || c.confirmed === false) s.manual = s.manual.filter((x) => x !== m);
        else Object.assign(m, Object.fromEntries(Object.entries({ amount: c.amount, cycle: c.cycle, nextDate: c.nextDate, remind: c.remind }).filter(([, v]) => v !== undefined)));
      } else if (hit) {
        if (c.remove || c.confirmed === false) s.decisions[hit.key] = false;
        else {
          if (c.confirmed) {
            s.decisions[hit.key] = true;
            if (hit.key.startsWith("card:")) next.recurring = { ...next.recurring, [hit.merchant]: true };
          }
          s.overrides[hit.key] = { ...s.overrides[hit.key], ...Object.fromEntries(Object.entries({ cycle: c.cycle, remind: c.remind }).filter(([, v]) => v !== undefined)) };
        }
      } else if (c.remove || c.confirmed === false) throw Error("그 이름의 구독을 찾지 못했습니다.");
      else if (c.amount === undefined || !c.cycle) throw Error("새 구독은 금액과 주기가 필요합니다.");
      else s.manual.push({ id: randomUUID(), name: c.name, amount: c.amount, cycle: c.cycle, nextDate: c.nextDate || today, paidWith: "", manageUrl: "", remind: c.remind ?? true });
      next["setting:subscriptions"] = s;
    } else if (c.type === "dca") {
      // a monthly buy plan, keyed by symbol; the stock itself is checked against Toss before the first order
      const d = dcaSchema.parse(next["setting:dca"] || {}),
        symbol = c.symbol.toUpperCase(),
        plan = d.plans.find((p) => p.symbol === symbol);
      if (c.remove) d.plans = d.plans.filter((p) => p.symbol !== symbol);
      else if (plan) Object.assign(plan, Object.fromEntries(Object.entries({ amount: c.amount, every: c.every, day: c.day, weekday: c.weekday, enabled: c.enabled }).filter(([, v]) => v !== undefined)));
      else if (!c.amount) throw Error("새 적립은 한 번에 살 금액이 필요합니다.");
      else d.plans.push({ id: randomUUID(), symbol, name: "", currency: /^[0-9]/.test(symbol) ? "KRW" : "USD", amount: c.amount, every: c.every ?? "month", day: c.day ?? "payday", weekday: c.weekday ?? 1, enabled: c.enabled ?? true, lastPeriod: "", lastTry: "" });
      next["setting:dca"] = d;
    } else if (c.type === "autoinvest") {
      const { type, ...patch } = c;
      next["setting:autoInvest"] = autoInvestSchema.parse({
        ...autoInvestSchema.parse(next["setting:autoInvest"] || {}),
        ...patch,
      });
    } else if (c.type === "notifications") {
      const { type, ...patch } = c;
      next["setting:notifications"] = notificationSettingsSchema.parse({
        ...notificationSettingsSchema.parse(next["setting:notifications"] || {}),
        ...patch,
      });
    } else if (c.type === "goal") {
      const id = c.id || randomUUID(),
        { type, ...input } = c,
        goal = purchaseGoalSchema.parse({ ...input, id });
      c.id = id;
      next.goals = [
        ...next.goals.filter((item) => item.id !== goal.id),
        goal,
      ];
    } else {
      if (!next.transactions.some((t) => t.merchant === c.merchant))
        throw Error(
          "말씀한 이용처를 거래에서 찾지 못했습니다. 이용처를 확인해주세요.",
        );
      if (c.type === "installment") {
        const targets = next.transactions.filter(
          (t) => t.merchant === c.merchant && t.date.startsWith(month) && (t.status === "unpaid" || t.installment),
        );
        if (!targets.length)
          throw Error("이 달에 할부로 돌릴 수 있는 미납 거래가 없습니다.");
        next.transactions = next.transactions.map((t) =>
          targets.includes(t) ? withInstallment(t, c.months, installmentTerms(next.profile)) : t,
        );
      } else if (c.type === "category")
        next.transactions = next.transactions.map((t) =>
          t.merchant === c.merchant
            ? {
                ...t,
                category: c.category,
                categoryOrigin: "correction",
                aiCategory: undefined,
              }
            : t,
        );
      else next.recurring[c.merchant] = c.confirmed;
    }
  }
  return {
    next,
    before,
    after: makePlan(next, month),
    basis: stateHash(state),
    changes,
    month,
  };
}
