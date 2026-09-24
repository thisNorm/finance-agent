import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  profileSchema,
  preferenceSchema,
  importSchema,
  category,
  monthSchema,
  currentMonth,
  analyze,
  makePlan,
  comparePurchase,
  purchaseGoalInputSchema,
  purchaseGoalSchema,
  purchaseGoalProgress,
  summarizeBankCashflow,
  withInstallment,
  installmentMonths,
  installmentTerms,
  markDuplicates,
  adviceText,
} from "./finance.js";
import { previewChanges, stateHash, changesSchema } from "./proposals.js";
import {
  reviewInput,
  reviewBasis,
  reviewSchema,
  validateReview,
  transactionKey,
} from "./review.js";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultDb = resolve(root, ".private", "finance.sqlite");
export function createStore(path = process.env.FINANCE_DB || defaultDb) {
  if (path !== ":memory:") path = resolve(root, path);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL);",
  );
  const get = (k, fallback) => {
    const r = db.prepare("SELECT value FROM state WHERE key=?").get(k);
    return r ? JSON.parse(r.value) : fallback;
  };
  const put = (k, v) =>
    db
      .prepare(
        "INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(k, JSON.stringify(v));
  const atomic = (action, fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.prepare("INSERT INTO events(at,action) VALUES (?,?)").run(
        new Date().toISOString(),
        action,
      );
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const snapshot = () => {
    const accounts = get("accounts", []),
      bankSync = get("bankSync", null),
      cardSync = get("cardSync", null),
      krwAccounts = accounts.filter((account) => account.currency === "KRW"),
      cashAccounts = krwAccounts.filter((account) =>
        ["10", "11"].includes(account.type),
      );
    return {
      profile: get("profile", null),
      preferences: get("preferences", []),
      transactions: markDuplicates(
        get("transactions", []).map((transaction) =>
          transaction.status === "unknown"
            ? { ...transaction, status: "unpaid" }
            : transaction,
        ),
      ),
      recurring: get("recurring", {}),
      coverage: get("coverage", []),
      goals: get("goals", []),
      "setting:autoSync": get("setting:autoSync", {}),
      "setting:notifications": get("setting:notifications", {}),
      "setting:autoInvest": get("setting:autoInvest", {}),
      accounts,
      bankTransactions: get("bankTransactions", []),
      bankSync,
      cardSync,
      accountSummary: {
        connected: !!bankSync,
        totalBalance: krwAccounts.reduce(
          (sum, account) => sum + account.balance,
          0,
        ),
        availableCash: cashAccounts.reduce(
          (sum, account) => sum + account.available,
          0,
        ),
        updatedAt: bankSync?.at || null,
      },
    };
  };
  function overview(month = currentMonth()) {
    monthSchema.parse(month);
    const s = snapshot(),
      plan = makePlan(s, month);
    return {
      ...s,
      analysis: analyze(s.transactions, s.recurring, s.coverage, month),
      bankCashflow: summarizeBankCashflow(s.bankTransactions, month),
      plan,
      goals: s.goals.map((goal) => ({
        ...goal,
        progress: purchaseGoalProgress(
          goal,
          plan,
          plan.ready && !s.profile?.savingsLocked ? plan.savings : 0,
          installmentTerms(s.profile),
          language(),
        ),
      })),
      aiReview: reviewStatus(month),
      // kept out of snapshot(): prices move all day and must not re-run analysis or stale proposals
      investments: get("investments", null),
      messages: get("messages", []),
      events: db
        .prepare("SELECT at,action FROM events ORDER BY id DESC LIMIT 12")
        .all(),
    };
  }
  const tools = {
    get_overview: {
      description:
        "거래·고정비 후보·소득·선호·계산된 예산을 조회합니다. 일부 기간 자료는 전체 소비로 해석하지 마세요.",
      schema: z.object({ month: monthSchema.optional() }).strict(),
      run: (p) => overview(p.month),
    },
    update_profile: {
      description:
        "사용자가 명시한 연간 세전 계약연봉·월 실수령액·저축 목표·비상자금 목표·기존 상환액 저장. 계약연봉으로 실수령액을 추정하지 않습니다. null 목표는 임시 20%/10% 기준입니다.",
      schema: profileSchema,
      run: (p) =>
        atomic("소득 및 목표 변경", () => {
          put("profile", p);
          return overview();
        }),
    },
    set_preference: {
      description:
        "사용자가 요청한 소비 항목 예산을 저장하고 재배분합니다. amount는 그 항목의 총 월 예산입니다. always 또는 YYYY-MM으로 기간을 명시하세요.",
      schema: preferenceSchema,
      run: (p) =>
        atomic("지출 선호 반영", () => {
          const list = get("preferences", []).filter(
            (x) => !(x.category === p.category && x.month === p.month),
          );
          put("preferences", [...list, p]);
          return overview(p.month === "always" ? undefined : p.month);
        }),
    },
    set_purchase_goal: {
      description:
        "사고 싶은 제품의 이름·금액·모은 금액과 선택적인 HTTPS 제품/이미지 주소를 저장합니다. id가 있으면 기존 목표를 수정합니다.",
      schema: purchaseGoalInputSchema,
      run: (p) =>
        atomic("구매 목표 변경", () => {
          const goals = get("goals", []);
          if (p.id && !goals.some((goal) => goal.id === p.id))
            throw Error("수정할 구매 목표를 찾지 못했습니다.");
          const goal = purchaseGoalSchema.parse({
            ...p,
            id: p.id || randomUUID(),
          });
          put("goals", [
            ...goals.filter((item) => item.id !== goal.id),
            goal,
          ]);
          return overview();
        }),
    },
    remove_purchase_goal: {
      description: "사용자가 지정한 구매 목표를 삭제합니다.",
      schema: z.object({ id: z.uuid() }).strict(),
      run: (p) =>
        atomic("구매 목표 삭제", () => {
          const goals = get("goals", []);
          if (!goals.some((goal) => goal.id === p.id))
            throw Error("삭제할 구매 목표를 찾지 못했습니다.");
          put(
            "goals",
            goals.filter((goal) => goal.id !== p.id),
          );
          return overview();
        }),
    },
    remove_preference: {
      description: "명시적으로 요청된 항목·기간의 선호를 삭제합니다.",
      schema: z
        .object({
          category,
          month: z.union([monthSchema, z.literal("always")]),
        })
        .strict(),
      run: (p) =>
        atomic("지출 선호 삭제", () => {
          put(
            "preferences",
            get("preferences", []).filter(
              (x) => !(x.category === p.category && x.month === p.month),
            ),
          );
          return overview();
        }),
    },
    categorize_transactions: {
      description:
        "지정 거래의 소비 항목을 수정합니다. 중개 결제 가맹점은 이름만으로 추정하지 마세요.",
      schema: z
        .object({
          ids: z.array(z.string()).min(1).max(500).optional(),
          merchant: z.string().min(1).max(200).optional(),
          category,
          source: z.string().max(80).optional(),
        })
        .strict()
        .refine((p) => !!p.ids !== !!p.merchant, "ids 또는 merchant 중 하나만 지정하세요."),
      run: (p) =>
        atomic("거래 분류 변경", () => {
          const rows = get("transactions", []);
          // A merchant can appear under several sources; one call covers them all.
          if (p.merchant) {
            const hit = rows.filter((t) => t.merchant === p.merchant);
            if (!hit.length) throw Error("존재하지 않는 이용처입니다.");
            put(
              "transactions",
              rows.map((t) =>
                t.merchant === p.merchant
                  ? { ...t, category: p.category, categoryOrigin: "correction", aiCategory: undefined }
                  : t,
              ),
            );
            return overview();
          }
          if (
            p.source === undefined &&
            p.ids.some((id) => rows.filter((t) => t.id === id).length > 1)
          )
            throw Error("중복 식별자입니다. 거래 출처를 지정하세요.");
          if (
            p.ids.some(
              (id) =>
                !rows.some(
                  (t) =>
                    t.id === id &&
                    (p.source === undefined || t.source === p.source),
                ),
            )
          )
            throw Error("존재하지 않는 거래입니다.");
          put(
            "transactions",
            rows.map((t) =>
              p.ids.includes(t.id) &&
              (p.source === undefined || t.source === p.source)
                ? {
                    ...t,
                    category: p.category,
                    categoryOrigin: "correction",
                    aiCategory: undefined,
                  }
                : t,
            ),
          );
          return overview();
        }),
    },
    set_installment: {
      description:
        "미납 카드 거래를 N개월 할부로 계획에 반영합니다(1은 해제). 3개월까지 무이자, 이상은 연 15% 수수료 가정. 카드사에 실제 신청하지는 않습니다.",
      schema: z
        .object({
          id: z.string().min(1),
          source: z.string().max(80),
          months: installmentMonths,
        })
        .strict(),
      run: (p) =>
        atomic("할부 반영", () => {
          const rows = get("transactions", []),
            t = rows.find((t) => t.id === p.id && t.source === p.source);
          if (!t) throw Error("존재하지 않는 거래입니다.");
          if (t.status !== "unpaid" && p.months !== 1)
            throw Error("미납 거래만 할부로 반영할 수 있습니다.");
          put("transactions", rows.map((x) => (x === t ? withInstallment(t, p.months, installmentTerms(get("profile"))) : x)));
          return overview();
        }),
    },
    confirm_recurring: {
      description:
        "사용자가 확인한 가맹점의 고정비 여부 저장. 반복 후보를 자동 확정하지 않습니다.",
      schema: z
        .object({
          merchant: z.string().min(1).max(200),
          confirmed: z.boolean(),
        })
        .strict(),
      run: (p) =>
        atomic("고정비 확인", () => {
          if (!get("transactions", []).some((t) => t.merchant === p.merchant))
            throw Error("확인 가능한 거래가 없습니다.");
          put("recurring", {
            ...get("recurring", {}),
            [p.merchant]: p.confirmed,
          });
          return overview();
        }),
    },
    compare_purchase: {
      description:
        "확인된 총 할부 수수료로 기간별 월 부담을 비교합니다. 미확인 조건을 무이자로 가정하지 않습니다.",
      schema: z
        .object({
          month: monthSchema.optional(),
          amount: z.number(),
          options: z.array(z.object({ months: z.number(), fee: z.number() })),
        })
        .strict(),
      run: (p) =>
        comparePurchase(makePlan(snapshot(), p.month), {
          amount: p.amount,
          options: p.options,
        }),
    },
    import_transactions: {
      description:
        "조회 기간과 거래를 저장합니다. source+id로 중복 방지. complete는 전체 기간을 확인한 경우만 true. 승인 거래는 unpaid, 납부 확인 거래만 paid입니다.",
      schema: importSchema,
      run: (p) =>
        atomic("거래 가져오기", () => {
          const map = new Map(
            get("transactions", []).map((t) => [transactionKey(t), t]),
          );
          for (const t of p.transactions) {
            const key = transactionKey(t),
              old = map.get(key);
            const unchanged =
              old &&
              old.date === t.date &&
              old.merchant === t.merchant &&
              old.amount === t.amount &&
              old.status === t.status;
            // A re-sync must not undo what the user decided: the category, the correction flag
            // and the installment they applied all survive. A changed amount only re-splits it.
            const installment =
              old?.installment && !["cancelled", "rejected"].includes(t.status)
                ? old.amount === t.amount
                  ? old.installment
                  : withInstallment(t, old.installment.months, installmentTerms(get("profile")))
                      .installment
                : undefined;
            map.set(
              key,
              old
                ? {
                    ...t,
                    category: old.category,
                    categoryOrigin: old.categoryOrigin,
                    ...(unchanged ? { aiCategory: old.aiCategory } : {}),
                    ...(installment ? { installment } : {}),
                  }
                : t,
            );
          }
          put(
            "transactions",
            [...map.values()].sort((a, b) => b.date.localeCompare(a.date)),
          );
          put("coverage", [
            ...get("coverage", []).filter(
              (c) =>
                !(c.from === p.from && c.to === p.to && c.source === p.source),
            ),
            {
              from: p.from,
              to: p.to,
              complete: p.complete,
              source: p.source,
              at: new Date().toISOString(),
            },
          ]);
          return overview();
        }),
    },
  };
  const call = (name, args) => {
    const tool = Object.hasOwn(tools, name) ? tools[name] : null;
    if (!tool) throw Error("지원하지 않는 작업입니다.");
    return tool.run(tool.schema.parse(args));
  };
  function reviewStatus(month) {
    const s = snapshot(),
      input = reviewInput(s, month, language()),
      report = get("ai-review:" + month, null);
    return {
      status: report?.status || "pending",
      ...report,
      // verdicts were written in whatever language was on at analysis time; reword them for now
      ...(report?.largeExpenses && {
        largeExpenses: report.largeExpenses.map((e) =>
          e.advice ? { ...e, advice: { ...e.advice, text: adviceText(e.advice, false, input.language) } } : e,
        ),
      }),
      stale: report?.basis !== input.basis,
      pendingCount: input.pendingCount,
    };
  }
  const language = () => (get("setting:lang") === "en" ? "en" : "ko");
  const getReviewInput = (month) => reviewInput(snapshot(), month, language());
  const saveReview = (input, result, provider) =>
    atomic("AI 자동 분류 및 지출 분석", () => {
      const s = snapshot(),
        parsed = validateReview(s, input, result);
      const classifications = new Map(
        parsed.classifications.map((c) => [c.key, c]),
      );
      const rows = s.transactions.map((t) => {
        const c = classifications.get(transactionKey(t));
        return c
          ? {
              ...t,
              category: c.confidence === "low" ? "other" : c.category,
              categoryOrigin: "ai",
              aiCategory: {
                confidence: c.confidence,
                reason: c.reason,
                at: new Date().toISOString(),
              },
            }
          : t;
      });
      put("transactions", rows);
      const report = {
        status: "complete",
        basis: reviewBasis(snapshot()),
        at: new Date().toISOString(),
        provider,
        summary: parsed.summary,
        insights: parsed.insights,
        scopeNote: input.scopeNote,
        reviewedCount: input.largeExpenseCandidates.length,
        paymentContext: input.paymentContext,
        adviceBasis: input.adviceBasis,
        prepaymentNote: parsed.prepaymentNote,
        prepayments: parsed.prepayments.map((item) => {
          const t = rows.find((t) => transactionKey(t) === item.key);
          return {
            ...item,
            id: t.id,
            source: t.source,
            date: t.date,
            merchant: t.merchant,
            amount: t.amount,
          };
        }),
        largeExpenses: parsed.largeExpenses.map((item) => {
          const t = rows.find((t) => transactionKey(t) === item.key);
          return {
            ...item,
            id: t.id,
            source: t.source,
            date: t.date,
            merchant: t.merchant,
            amount: t.amount,
            status: t.status,
            installment: t.installment ?? null,
            incomePercent:
              Math.round((t.amount / input.plan.income) * 10000) / 100,
            advice:
              input.largeExpenseCandidates.find((c) => c.key === item.key)
                ?.advice ?? null,
            nextStep:
              input.largeExpenseCandidates.find((c) => c.key === item.key)?.fixed
                ? "fixed"
                : t.status === "paid"
                ? "spending_review"
                : t.status === "unpaid"
                  ? "check_terms"
                  : "check_payment",
          };
        }),
      };
      put("ai-review:" + input.month, report);
      return report;
    });
  const reviewFailed = (month, basis, message) => {
    put("ai-review:" + month, {
      status: "error",
      basis,
      error: message,
      at: new Date().toISOString(),
    });
  };
  tools.get_analysis_input = {
    description:
      "AI가 자동 분류, 소득 대비 큰 지출, 안전 범위 안의 선납 추천에 사용할 거래와 계산 근거. 먼저 이 도구를 호출하고 모든 classificationBatch 항목을 분류하세요.",
    schema: z.object({ month: monthSchema }).strict(),
    run: (p) => getReviewInput(p.month),
  };
  tools.save_analysis = {
    description:
      "AI 분석 결과를 저장하고 분류를 자동 반영합니다. 사용자가 수정한 분류는 제외되며 존재하지 않는 거래, 보호 금액을 넘는 선납 추천, 오래된 결과는 거절됩니다. 금리나 납부 여부를 추정하지 마세요.",
    schema: z
      .object({ month: monthSchema, basis: z.string(), result: reviewSchema })
      .strict(),
    run: (p) => {
      const input = getReviewInput(p.month);
      if (input.basis !== p.basis)
        throw Error("자료가 변경되어 다시 분석해야 합니다.");
      return saveReview(input, p.result, "MCP");
    },
  };
  const saveMessage = (role, text, proposal = null) =>
    atomic("대화 " + (role === "user" ? "요청" : "응답"), () => {
      const m = {
        id: randomUUID(),
        role,
        text,
        proposal,
        at: new Date().toISOString(),
      };
      put("messages", [...get("messages", []), m].slice(-100));
      return m;
    });
  const saveBankSync = ({ accounts, transactions, coverage }) =>
    atomic("계좌 자료 동기화", () => {
      const rows = new Map(
        get("bankTransactions", []).map((transaction) => [
          transaction.id,
          transaction,
        ]),
      );
      for (const transaction of transactions) rows.set(transaction.id, transaction);
      put("accounts", accounts);
      put(
        "bankTransactions",
        [...rows.values()]
          .sort((a, b) =>
            `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`),
          )
          .slice(0, 5000),
      );
      put("bankSync", coverage);
      return overview();
    });
  const saveInvestments = (investments) =>
    atomic("투자 자료 동기화", () => {
      put("investments", investments);
      return overview();
    });
  const clearInvestments = () => db.prepare("DELETE FROM state WHERE key=?").run("investments");
  const saveCardSync = ({ transactions, from, to, complete, source, bills, coverage }) => {
    call("import_transactions", { transactions, from, to, complete, source });
    return atomic("카드 자료 동기화", () => {
      put("cardSync", { ...coverage, bills });
      return overview();
    });
  };
  const preview = (changes, month) => {
    const { next, ...result } = previewChanges(snapshot(), changes, month);
    return result;
  };
  const applyProposal = (id) =>
    atomic("대화 제안 적용", () => {
      const messages = get("messages", []),
        m = messages.find((x) => x.id === id);
      if (!m?.proposal || m.applied)
        throw Error("적용 가능한 제안이 없습니다.");
      // Settings-only proposals do not depend on the data snapshot, so a sync in between must not block them.
      const touchesData = m.proposal.changes.some(
        (c) => !["autosync", "notifications", "autoinvest"].includes(c.type),
      );
      if (touchesData && m.proposal.basis !== stateHash(snapshot()))
        throw Error(
          "자료가 변경되었습니다. 변경안 다시 계산을 눌러 확인하세요.",
        );
      const r = previewChanges(
        snapshot(),
        m.proposal.changes,
        m.proposal.month,
      );
      for (const [key, value] of Object.entries(r.next)) put(key, value);
      m.applied = true;
      put("messages", messages);
      return overview(m.proposal.month);
    });
  const refreshProposal = (id) =>
    atomic("변경안 재계산", () => {
      const messages = get("messages", []),
        m = messages.find((x) => x.id === id);
      if (!m?.proposal || m.applied) throw Error("재계산할 제안이 없습니다.");
      m.proposal = preview(m.proposal.changes, m.proposal.month);
      put("messages", messages);
      return m;
    });
  tools.preview_changes = {
    description:
      "자연어로 해석한 여러 변경을 저장 없이 함께 계산합니다. 상대 금액, 적용 월, 저축 보호를 검증합니다.",
    schema: z.object({ changes: changesSchema, month: monthSchema }).strict(),
    run: (p) => preview(p.changes, p.month),
  };
  tools.apply_changes = {
    description:
      "사용자가 요청한 변경 묶음을 원자적으로 반영합니다. preview_changes의 basis를 전달하며 자료가 바뀌면 거절됩니다.",
    schema: z
      .object({ changes: changesSchema, month: monthSchema, basis: z.string() })
      .strict(),
    run: (p) =>
      atomic("MCP 계획 변경", () => {
        if (stateHash(snapshot()) !== p.basis)
          throw Error("자료가 변경되어 다시 계산해야 합니다.");
        const r = previewChanges(snapshot(), p.changes, p.month);
        for (const [k, v] of Object.entries(r.next)) put(k, v);
        return overview(p.month);
      }),
  };
  // One-time private migration. Public source never contains the owner's transactions.
  const legacy = resolve(root, ".private/legacy-transactions.json");
  if (
    resolve(path) === defaultDb &&
    !get("migrated", false) &&
    existsSync(legacy)
  ) {
    const rows = JSON.parse(readFileSync(legacy, "utf8")).map((t) => ({
      id: t.id,
      date: t.date,
      merchant: t.merchant,
      amount: t.amount,
      status: t.status,
      category: "other",
      source: "hyundai-web-snapshot",
      evidence: t.evidence.map((e) => e.join(": ")).join("\n"),
    }));
    call("import_transactions", {
      transactions: rows,
      from: "2026-09-12",
      to: "2026-09-18",
      complete: false,
      source: "hyundai-web-snapshot",
    });
    put("migrated", true);
  }
  return {
    databasePath: path,
    overview,
    call,
    tools,
    saveMessage,
    saveBankSync,
    saveCardSync,
    saveInvestments,
    clearInvestments,
    preview,
    applyProposal,
    refreshProposal,
    getReviewInput,
    saveReview,
    reviewFailed,
    // Small app settings that are not financial state (notification channels, dedupe markers).
    getSetting: (key, fallback) => get("setting:" + key, fallback),
    setSetting: (key, value) => put("setting:" + key, value),
    close: () => db.close(),
  };
}
