import { z } from "zod";
import {
  category,
  monthSchema,
  analyze,
  makePlan,
  currentDate,
  summarizeBankCashflow,
  paymentAdvice,
  installmentDefaults,
} from "./finance.js";
import { stateHash } from "./proposals.js";
export const transactionKey = (t) => JSON.stringify([t.source, t.id]);
export const reviewSchema = z
  .object({
    classifications: z
      .array(
        z
          .object({
            key: z.string(),
            category,
            confidence: z.enum(["high", "medium", "low"]),
            reason: z.string().min(1).max(600),
          })
          .strict(),
      )
      .max(100),
    summary: z.string().min(1).max(400),
    insights: z
      .array(
        z
          .object({ title: z.string().max(40), detail: z.string().max(220) })
          .strict(),
      )
      .max(3),
    largeExpenses: z
      .array(
        z
          .object({ key: z.string(), reason: z.string().min(1).max(160) })
          .strict(),
      )
      .max(12),
    prepaymentNote: z.string().min(1).max(200),
    prepayments: z
      .array(
        z
          .object({ key: z.string(), reason: z.string().min(1).max(160) })
          .strict(),
      )
      .max(12),
  })
  .strict();
export function reviewBasis(s) {
  return stateHash({
    reviewVersion: 7,
    ...s,
    coverage: s.coverage.map(({ at, ...c }) => c),
  });
}
function nextPayday(today, payday) {
  if (!payday) return null;
  const now = new Date(today + "T00:00:00Z");
  let year = now.getUTCFullYear(),
    month = now.getUTCMonth();
  if (now.getUTCDate() >= payday) {
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  const day = Math.min(payday, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  const date = new Date(Date.UTC(year, month, day));
  return {
    date: date.toISOString().slice(0, 10),
    daysUntil: Math.ceil((date - now) / 86400000),
  };
}
export function reviewInput(state, month) {
  monthSchema.parse(month);
  const active = state.transactions.filter(
    (t) => !["cancelled", "rejected"].includes(t.status),
  );
  const pending = active.filter(
    (t) => !t.aiCategory && t.categoryOrigin !== "correction",
  );
  const classificationBatch = pending.slice(0, 100);
  // All transactions are classified in bounded batches. Risk review uses the largest 100 in the selected month, explicitly reported.
  const monthRows = active
    .filter((t) => t.date.startsWith(month))
    .sort((a, b) => b.amount - a.amount);
  const plan = makePlan(state, month),
    income = plan.ready ? plan.income : 0,
    payday = nextPayday(currentDate(), state.profile?.payday),
    balance = state.accountSummary?.connected
      ? state.accountSummary.availableCash
      : state.profile?.balance || 0;
  const row = (t) => ({
    key: transactionKey(t),
    date: t.date,
    merchant: t.merchant,
    amount: t.amount,
    status: t.status,
    category: t.category,
    incomePercent: income
      ? Math.round((t.amount / income) * 10000) / 100
      : null,
  });
  const protectedCash = plan.ready
    ? plan.savings +
      plan.reserve +
      plan.debt +
      plan.fixedTotal +
      Math.ceil(
        (plan.allocations.reduce((sum, item) => sum + item.amount, 0) *
          Math.min(payday?.daysUntil ?? 31, 31)) /
          31,
      )
    : null;
  const prepaymentCandidates = monthRows
    .filter((t) => t.status === "unpaid")
    .slice(0, 100)
    .map(row);
  const cashNow = protectedCash === null ? 0 : Math.max(0, balance - protectedCash),
    flexible = plan.ready && !state.profile?.savingsLocked ? plan.savings : 0;
  const withAdvice = (t) => ({
    ...row(t),
    fixed: state.recurring?.[t.merchant] === true,
    advice:
      t.status === "unpaid" && plan.ready && state.recurring?.[t.merchant] !== true
        ? { ...paymentAdvice(t.amount, { free: plan.free, cashNow, flexible }), provisional: plan.provisional }
        : null,
  });
  const analysis = analyze(
    state.transactions,
    state.recurring,
    state.coverage,
    month,
  ),
    bankCashflow = summarizeBankCashflow(state.bankTransactions, month);
  return {
    currentDate: currentDate(),
    month,
    basis: reviewBasis(state),
    profile: state.profile,
    preferences: state.preferences,
    analysis,
    plan,
    accountSummary: state.accountSummary,
    accounts: state.accounts.map(({ display, name, type, currency, balance, available }) => ({
      display,
      name,
      type,
      currency,
      balance,
      available,
    })),
    bankCashflow,
    bankTransactions: state.bankTransactions
      .filter(({ date }) => date.startsWith(month))
      .slice(0, 150).map(
      ({ date, direction, amount, description }) => ({
        date,
        direction,
        amount,
        description,
      }),
    ),
    classificationBatch: classificationBatch.map(row),
    pendingCount: pending.length,
    largeExpenseCandidates: monthRows.slice(0, 100).map(withAdvice),
    installmentAssumptions: {
      ...installmentDefaults,
      note: "기본 가정: 3개월까지 무이자, 그 이상은 연 15% 수수료. advice는 이 가정으로 서버가 계산한 결론이며 모델은 바꾸지 않는다.",
    },
    prepaymentCandidates,
    paymentContext: {
      balance,
      nextPayday: payday?.date || null,
      daysUntilPayday: payday?.daysUntil ?? null,
      protectedCash,
      availableForPrepayment:
        protectedCash === null ? null : Math.max(0, balance - protectedCash),
      calculation:
        "현재 잔액에서 저축·비상금·기존 상환·고정비와 다음 급여일까지의 변동예산을 보호한 보수적 상한",
    },
    monthTransactionCount: monthRows.length,
    scopeNote:
      analysis.complete
        ? "선택한 달 전체 조회 자료 기준입니다."
        : monthRows.length > 100
        ? "큰 지출 검토는 이 달 금액 상위 100건 기준입니다."
        : "현재 저장된 이 달 거래 기준입니다.",
  };
}
export function validateReview(state, input, result) {
  result = reviewSchema.parse(result);
  if (reviewBasis(state) !== input.basis)
    throw Error("분석 중 자료가 변경되어 최신 자료로 다시 분석합니다.");
  const expected = new Set(input.classificationBatch.map((t) => t.key));
  if (
    result.classifications.length !== expected.size ||
    new Set(result.classifications.map((c) => c.key)).size !== expected.size ||
    result.classifications.some((c) => !expected.has(c.key))
  )
    throw Error("AI 분류 대상이 거래 목록과 일치하지 않습니다.");
  const allowed = new Set(input.largeExpenseCandidates.map((t) => t.key));
  if (
    new Set(result.largeExpenses.map((c) => c.key)).size !==
      result.largeExpenses.length ||
    result.largeExpenses.some((c) => !allowed.has(c.key))
  )
    throw Error("AI가 존재하지 않는 거래를 제시해 결과를 반영하지 않았습니다.");
  if (!input.plan.ready && result.largeExpenses.length)
    throw Error("소득 없이 소득 대비 큰 지출을 확정할 수 없습니다.");
  const prepayable = new Map(
    input.prepaymentCandidates.map((t) => [t.key, t.amount]),
  );
  if (
    new Set(result.prepayments.map((c) => c.key)).size !==
      result.prepayments.length ||
    result.prepayments.some((c) => !prepayable.has(c.key))
  )
    throw Error("AI가 선납 대상이 아닌 거래를 제시해 결과를 반영하지 않았습니다.");
  const prepaymentTotal = result.prepayments.reduce(
    (sum, item) => sum + prepayable.get(item.key),
    0,
  );
  if (
    input.paymentContext.availableForPrepayment === null
      ? prepaymentTotal > 0
      : prepaymentTotal > input.paymentContext.availableForPrepayment
  )
    throw Error("AI 선납 추천액이 보호 금액을 침범해 결과를 반영하지 않았습니다.");
  return result;
}
