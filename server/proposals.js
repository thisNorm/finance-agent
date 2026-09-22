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
} from "./finance.js";
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
          targets.includes(t) ? withInstallment(t, c.months) : t,
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
