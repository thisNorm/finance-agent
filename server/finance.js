import { z } from "zod";

export const categories = {
  grocery: "식료품",
  dining: "식사·카페",
  alcohol: "술자리",
  transport: "교통",
  housing: "주거",
  telecom: "통신",
  subscription: "구독",
  shopping: "쇼핑",
  health: "건강",
  leisure: "여가",
  other: "미분류",
};
export const category = z.enum(Object.keys(categories));
export const money = z.number().int().min(0).max(1_000_000_000);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, "올바른 날짜가 필요합니다.");
export const profileSchema = z
  .object({
    income: money,
    annualGross: money.default(0),
    balance: money.default(0),
    payday: z.number().int().min(1).max(31).nullable().default(null),
    savings: money.nullable(),
    reserve: money.nullable(),
    debt: money,
    savingsLocked: z.boolean().default(false),
    reserveLocked: z.boolean().default(false),
  })
  .strict();
export const preferenceSchema = z
  .object({
    category,
    amount: money,
    month: z.union([monthSchema, z.literal("always")]),
    note: z.string().max(300).default(""),
  })
  .strict();
export const transactionSchema = z
  .object({
    id: z.string().min(1).max(150),
    date: dateSchema,
    merchant: z.string().trim().min(1).max(200),
    amount: money,
    category: category.default("other"),
    status: z.preprocess(
      (value) => (value === undefined || value === "unknown" ? "unpaid" : value),
      z.enum(["paid", "unpaid", "cancelled", "partial", "rejected"]),
    ),
    source: z.string().max(80).default("file"),
    evidence: z.string().max(2000).default(""),
  })
  .strict();
export const importSchema = z
  .object({
    transactions: z.array(transactionSchema).max(10000),
    from: dateSchema,
    to: dateSchema,
    complete: z.boolean().default(false),
    source: z.string().max(80).default("file"),
  })
  .strict()
  .refine(
    (v) =>
      v.from <= v.to &&
      v.transactions.every((t) => t.date >= v.from && t.date <= v.to),
    "거래일과 조회 기간을 확인하세요.",
  );
export const purchaseSchema = z
  .object({
    amount: money,
    options: z
      .array(
        z
          .object({ months: z.number().int().min(2).max(60), fee: money })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "HTTPS 주소를 입력하세요.");
const purchaseGoalFields = {
  name: z.string().trim().min(1).max(120),
  productUrl: httpsUrlSchema.default(""),
  imageUrl: httpsUrlSchema.default(""),
  price: money.refine((value) => value > 0, "제품 금액을 입력하세요."),
  saved: money.default(0),
  note: z.string().trim().max(300).default(""),
};
const savedWithinPrice = (goal) => goal.saved <= goal.price;
export const purchaseGoalInputSchema = z
  .object({ id: z.uuid().optional(), ...purchaseGoalFields })
  .strict()
  .refine(savedWithinPrice, "모은 금액은 제품 금액보다 클 수 없습니다.");
export const purchaseGoalSchema = z
  .object({ id: z.uuid(), ...purchaseGoalFields })
  .strict()
  .refine(savedWithinPrice, "모은 금액은 제품 금액보다 클 수 없습니다.");
export const currentMonth = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
export const currentDate = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const median = (a) => {
  const s = [...a].sort((a, b) => a - b);
  return Math.round(
    (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2,
  );
};
const active = (t) => !["cancelled", "rejected"].includes(t.status);

const workIncomeDeduction = (gross) =>
  gross <= 5_000_000
    ? gross * 0.7
    : gross <= 15_000_000
      ? 3_500_000 + (gross - 5_000_000) * 0.4
      : gross <= 45_000_000
        ? 7_500_000 + (gross - 15_000_000) * 0.15
        : gross <= 100_000_000
          ? 12_000_000 + (gross - 45_000_000) * 0.05
          : Math.min(20_000_000, 14_750_000 + (gross - 100_000_000) * 0.02);
const progressiveTax = (base) => {
  const brackets = [
    [14_000_000, 0.06, 0],
    [50_000_000, 0.15, 1_260_000],
    [88_000_000, 0.24, 5_760_000],
    [150_000_000, 0.35, 15_440_000],
    [300_000_000, 0.38, 19_940_000],
    [500_000_000, 0.4, 25_940_000],
    [1_000_000_000, 0.42, 35_940_000],
    [Infinity, 0.45, 65_940_000],
  ];
  const [, rate, deduction] = brackets.find(([limit]) => base <= limit);
  return Math.max(0, base * rate - deduction);
};
export function estimateMonthlyNet(annualGross) {
  money.parse(annualGross);
  if (!annualGross) return null;
  const monthlyGross = Math.round(annualGross / 12);
  const pension = Math.round(monthlyGross * 0.0475);
  const healthAndCare = Math.round(monthlyGross * 0.040674);
  const employment = Math.round(monthlyGross * 0.009);
  const specialDeduction =
    annualGross <= 30_000_000
      ? 3_100_000 + annualGross * 0.04
      : annualGross <= 45_000_000
        ? 3_100_000 + annualGross * 0.04 - (annualGross - 30_000_000) * 0.05
        : annualGross <= 70_000_000
          ? 3_100_000 + annualGross * 0.015
          : 3_100_000 + annualGross * 0.005;
  const taxable = Math.max(
    0,
    annualGross -
      workIncomeDeduction(annualGross) -
      1_500_000 -
      annualGross * 0.0475 -
      specialDeduction,
  );
  const calculatedTax = progressiveTax(taxable);
  const taxCredit = Math.min(
    calculatedTax <= 1_300_000
      ? calculatedTax * 0.55
      : 715_000 + (calculatedTax - 1_300_000) * 0.3,
    annualGross <= 33_000_000 ? 740_000 : 660_000,
  );
  const incomeTax = Math.round(Math.max(0, calculatedTax - taxCredit) / 12);
  const localTax = Math.floor(incomeTax * 0.1);
  const net =
    Math.floor(
      (monthlyGross -
        pension -
        healthAndCare -
        employment -
        incomeTax -
        localTax) /
        10_000,
    ) * 10_000;
  return {
    net: Math.max(0, net),
    monthlyGross,
    deductions: { pension, healthAndCare, employment, incomeTax, localTax },
    year: 2026,
    assumption: "본인 1명 · 비과세 없음 · 원천징수 100%",
  };
}

export function analyze(
  transactions,
  recurring,
  coverage,
  month = currentMonth(),
) {
  const usable = transactions.filter(active);
  const rows = usable.filter((t) => t.date.startsWith(month));
  const totals = Object.fromEntries(Object.keys(categories).map((k) => [k, 0]));
  rows.forEach((t) => (totals[t.category] += t.amount));
  const byMerchant = new Map();
  usable.forEach((t) => {
    const a = byMerchant.get(t.merchant) || [];
    a.push(t);
    byMerchant.set(t.merchant, a);
  });
  const candidates = [];
  for (const [merchant, list] of byMerchant) {
    const ordered = [...list].sort((a, b) => b.date.localeCompare(a.date));
    const recent = ordered.filter(
      (t) =>
        t.date >= monthOffset(month, -3) + "-01" && t.date <= month + "-31",
    );
    const months = [...new Set(recent.map((t) => t.date.slice(0, 7)))];
    const perMonth = months.map((m) =>
      recent.filter((t) => t.date.startsWith(m)),
    );
    const days = recent.map((t) => Number(t.date.slice(-2))),
      amounts = recent.map((t) => t.amount);
    const pattern =
      months.length >= 3 &&
      perMonth.every((a) => a.length === 1) &&
      Math.max(...days) - Math.min(...days) <= 7 &&
      Math.max(...amounts) <= Math.min(...amounts) * 1.25;
    const decision = recurring[merchant];
    if (pattern || decision === true)
      candidates.push({
        merchant,
        amount: median(
          (recent.length ? recent : ordered.slice(0, 3)).map((t) => t.amount),
        ),
        category: ordered[0].category,
        months: months.length,
        confirmed: decision === true,
        dismissed: decision === false,
        lastDate: ordered[0].date,
        reason: pattern
          ? "최근 3개월 이상 비슷한 시기·금액으로 결제"
          : "사용자가 고정비로 지정",
      });
  }
  const end = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const complete = coverage.some(
    (c) => c.complete && c.from <= month + "-01" && c.to >= end,
  );
  return {
    month,
    total: rows.reduce((s, t) => s + t.amount, 0),
    count: rows.length,
    totals,
    candidates,
    complete,
    partial: rows.some((t) => t.status === "partial"),
    top: [...byMerchant]
      .map(([merchant, list]) => ({
        merchant,
        amount: list
          .filter((t) => t.date.startsWith(month))
          .reduce((s, t) => s + t.amount, 0),
      }))
      .filter((t) => t.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
  };
}
export function summarizeBankCashflow(transactions, month = currentMonth()) {
  monthSchema.parse(month);
  const rows = transactions.filter((transaction) =>
    transaction.date.startsWith(month),
  );
  const incoming = rows
    .filter((transaction) => transaction.direction === "in")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const outgoing = rows
    .filter((transaction) => transaction.direction === "out")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return { month, incoming, outgoing, net: incoming - outgoing, count: rows.length };
}
function monthOffset(month, delta) {
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}
export function makePlan(state, month = currentMonth()) {
  const analysis = analyze(
      state.transactions,
      state.recurring,
      state.coverage,
      month,
    ),
    p = state.profile,
    incomeEstimate = !p?.income ? estimateMonthlyNet(p?.annualGross || 0) : null,
    income = p?.income || incomeEstimate?.net || 0;
  if (!p || income === 0)
    return {
      ready: false,
      reason:
        "월 실수령 소득을 입력하면 거래 내역을 바탕으로 배분안을 만듭니다.",
    };
  const fixed = analysis.candidates.filter((c) => c.confirmed);
  const fixedNames = new Set(fixed.map((c) => c.merchant));
  const months = [1, 2, 3]
    .map((n) => monthOffset(month, -n))
    .filter((m) => analyze(state.transactions, {}, state.coverage, m).complete);
  const baseMonths = months.length ? months : [month];
  const base = {};
  for (const k of Object.keys(categories)) {
    base[k] = Math.round(
      state.transactions
        .filter(
          (t) =>
            active(t) &&
            baseMonths.includes(t.date.slice(0, 7)) &&
            !fixedNames.has(t.merchant) &&
            t.category === k,
        )
        .reduce((s, t) => s + t.amount, 0) / baseMonths.length,
    );
  }
  const selected = {};
  state.preferences
    .filter((p) => p.month === "always")
    .forEach((p) => (selected[p.category] = p));
  state.preferences
    .filter((p) => p.month === month)
    .forEach((p) => (selected[p.category] = p));
  const fixedTotal = fixed.reduce((s, t) => s + t.amount, 0);
  const fixedByCategory = Object.fromEntries(
    Object.keys(categories).map((k) => [
      k,
      fixed.filter((f) => f.category === k).reduce((s, f) => s + f.amount, 0),
    ]),
  );
  const conflicts = Object.values(selected)
    .filter((p) => p.amount < fixedByCategory[p.category])
    .map((p) => categories[p.category] + " 예산보다 확정 고정비가 큽니다.");
  const locked = Object.values(selected).reduce(
    (s, p) => s + Math.max(0, p.amount - fixedByCategory[p.category]),
    0,
  );
  const targetSavings = p.savings ?? Math.round(income * 0.2),
    targetReserve = p.reserve ?? Math.round(income * 0.1);
  const desired =
    Object.entries(base)
      .filter(([k]) => !selected[k])
      .reduce((s, [, v]) => s + v, 0) +
    (p.savingsLocked ? 0 : targetSavings) +
    (p.reserveLocked ? 0 : targetReserve);
  const remaining =
    income -
    fixedTotal -
    p.debt -
    locked -
    (p.savingsLocked ? targetSavings : 0) -
    (p.reserveLocked ? targetReserve : 0);
  const scale = desired ? Math.min(1, Math.max(0, remaining) / desired) : 1;
  const allocations = Object.keys(categories)
    .map((k) => ({
      category: k,
      label: categories[k],
      target: selected[k]?.amount ?? base[k],
      amount: selected[k]
        ? Math.max(0, selected[k].amount - fixedByCategory[k])
        : Math.floor(base[k] * scale),
      fixedBudget: fixedByCategory[k],
      protected: !!selected[k],
      actual: analysis.totals[k],
      fixedActual: state.transactions
        .filter(
          (t) =>
            active(t) &&
            t.date.startsWith(month) &&
            t.category === k &&
            fixedNames.has(t.merchant),
        )
        .reduce((s, t) => s + t.amount, 0),
    }))
    .filter((r) => r.target || r.actual);
  const savings = p.savingsLocked
      ? targetSavings
      : Math.floor(targetSavings * scale),
    reserve = p.reserveLocked
      ? targetReserve
      : Math.floor(targetReserve * scale);
  const free =
    income -
    fixedTotal -
    p.debt -
    allocations.reduce((s, t) => s + t.amount, 0) -
    savings -
    reserve;
  return {
    ready: true,
    month,
    income,
    incomeEstimated: !!incomeEstimate,
    incomeEstimate,
    fixed,
    fixedTotal,
    debt: p.debt,
    allocations,
    savings,
    reserve,
    targetSavings,
    targetReserve,
    free,
    shortage: Math.max(0, -remaining),
    conflicts,
    provisional: !!incomeEstimate || !months.length || analysis.partial,
    baseMonths,
    unconfirmed: analysis.candidates.filter((c) => !c.confirmed && !c.dismissed)
      .length,
    defaults: { savings: p.savings === null, reserve: p.reserve === null },
  };
}
export function comparePurchase(plan, input) {
  const p = purchaseSchema.parse(input);
  if (!plan.ready) throw Error("소득과 계획을 먼저 입력하세요.");
  const options = [{ months: 1, fee: 0 }, ...p.options].map((o) => ({
    ...o,
    total: p.amount + o.fee,
    monthly: Math.ceil((p.amount + o.fee) / o.months),
    remaining: plan.free - Math.ceil((p.amount + o.fee) / o.months),
  }));
  const preferred =
    plan.provisional ||
    plan.unconfirmed ||
    plan.shortage ||
    plan.conflicts?.length
      ? null
      : ([...options]
          .filter((o) => o.remaining >= 0)
          .sort((a, b) => a.fee - b.fee || a.months - b.months)[0]?.months ??
        null);
  return {
    options,
    preferred,
    ratio: plan.income ? p.amount / plan.income : null,
    note: "소득·예산이 유지된다는 가정의 균등 월 부담 추정입니다. 실제 잔액·결제일·카드사 자격은 확인하지 않았습니다. 미입력 할부 조건은 비교하지 않습니다.",
    provisional: plan.provisional || plan.unconfirmed > 0,
  };
}

export function purchaseGoalProgress(goal, plan) {
  const remaining = Math.max(0, goal.price - goal.saved);
  const monthlyAvailable = plan.ready ? Math.max(0, plan.free) : null;
  return {
    percent: Math.min(100, Math.round((goal.saved / goal.price) * 100)),
    remaining,
    monthlyAvailable,
    cashMonths:
      remaining === 0
        ? 0
        : monthlyAvailable > 0
          ? Math.ceil(remaining / monthlyAvailable)
          : null,
  };
}
