import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

let token = "";
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "X-Finance-Token": token,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "요청에 실패했습니다.");
  return data;
}
const won = (n) => new Intl.NumberFormat("ko-KR").format(n) + "원";
const labels = {
  paid: "납부 확인",
  unpaid: "미납",
  cancelled: "취소",
  partial: "부분취소 확인 필요",
  rejected: "승인 거절",
};
const nowMonth = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
const inputDate = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const defaultBankFrom = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 3, 1);
  return inputDate(date);
};
const readCertificateFile = (file) =>
  new Promise((resolve, reject) => {
    if (!file?.size) return resolve("");
    if (file.size > 512_000)
      return reject(Error("인증서 파일은 각각 500KB 이하여야 합니다."));
    const reader = new FileReader();
    reader.onerror = () => reject(Error("인증서 파일을 읽지 못했습니다."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
const bankMethodLabels = {
  id: "인터넷뱅킹 ID",
  certificate: "공동인증서",
  connected: "Connected ID",
  quick: "빠른조회",
};
function EyeIcon({ hidden }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
      {hidden && <path d="M3 3l18 18" />}
    </svg>
  );
}
function Amount({
  label,
  name,
  value,
  optional = false,
  placeholder = "자동 제안",
}) {
  return (
    <label>
      {label}
      <span className="input-unit">
        <input
          name={name}
          type="number"
          min="0"
          max="1000000000"
          step="1"
          required={!optional}
          defaultValue={value ?? ""}
          placeholder={optional ? placeholder : ""}
        />
        <span>원</span>
      </span>
    </label>
  );
}

function GoalForm({ goal, onSave }) {
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          f = Object.fromEntries(new FormData(form));
        if (!(await onSave({
          ...(goal ? { id: goal.id } : {}),
          name: f.name,
          productUrl: f.productUrl,
          imageUrl: f.imageUrl,
          price: Number(f.price),
          saved: Number(f.saved),
          note: f.note,
        }))) return;
        if (!goal) form.reset();
        form.closest("details").open = false;
      }}
    >
      <div className="form-grid">
        <label>
          제품명
          <input
            name="name"
            required
            maxLength="120"
            defaultValue={goal?.name || ""}
            placeholder="예: 작업용 모니터"
          />
        </label>
        <Amount label="제품 금액" name="price" value={goal?.price} />
        <Amount label="이 목표에 모은 금액" name="saved" value={goal?.saved ?? 0} />
        <label>
          제품 링크 · 선택
          <input
            name="productUrl"
            type="url"
            maxLength="2048"
            defaultValue={goal?.productUrl || ""}
            placeholder="https://"
          />
        </label>
        <label>
          제품 이미지 주소 · 선택
          <input
            name="imageUrl"
            type="url"
            maxLength="2048"
            defaultValue={goal?.imageUrl || ""}
            placeholder="https://"
          />
        </label>
        <label>
          메모 · 선택
          <input
            name="note"
            maxLength="300"
            defaultValue={goal?.note || ""}
            placeholder="예: 업무 환경 개선"
          />
        </label>
      </div>
      <button className="primary">{goal ? "목표 수정" : "목표 추가"}</button>
    </form>
  );
}

function PurchaseGoals({ goals, plan, onSave, onRemove, onDiscuss }) {
  return (
    <section className="goals" aria-labelledby="goals-title">
      <div className="section-header">
        <h2 id="goals-title">구매 목표</h2>
        <span className="fine">별도 적립액 기준</span>
      </div>
      {goals.length ? (
        <div className="goal-list">
          {goals.map((goal) => (
            <article className="goal" key={goal.id}>
              {goal.imageUrl && (
                <img
                  src={goal.imageUrl}
                  alt={`${goal.name} 제품 이미지`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => (e.currentTarget.hidden = true)}
                />
              )}
              <div className="goal-body">
                <div className="expense-title">
                  <h3>{goal.name}</h3>
                  <strong>{won(goal.price)}</strong>
                </div>
                <progress
                  value={goal.saved}
                  max={goal.price}
                  aria-label={`${goal.name} 구매 목표 진행률 ${goal.progress.percent}%`}
                />
                <p className="goal-progress">
                  <strong>{goal.progress.percent}%</strong> · {won(goal.saved)}
                  모음 · {won(goal.progress.remaining)} 남음
                </p>
                <p className="fine">
                  {goal.progress.remaining === 0
                    ? "구매 금액을 모두 모았습니다."
                    : !plan.ready
                      ? "월 소득을 입력하면 예상 기간을 계산합니다."
                      : goal.progress.cashMonths
                        ? `현재 배분 후 남는 돈을 모두 모으면 약 ${goal.progress.cashMonths}개월입니다.`
                        : "현재 배분에서는 목표에 추가할 여유 금액이 없습니다."}
                </p>
                {goal.note && <p>{goal.note}</p>}
                {goal.productUrl && (
                  <a
                    href={goal.productUrl}
                    target="_blank"
                    rel="noreferrer nofollow"
                  >
                    제품 페이지 열기 ↗
                  </a>
                )}
                <div className="goal-actions">
                  <button className="quiet" onClick={() => onDiscuss(goal)}>
                    대화로 계획 세우기
                  </button>
                  <details>
                    <summary>목표 수정</summary>
                    <GoalForm goal={goal} onSave={onSave} />
                  </details>
                  <button className="quiet" onClick={() => onRemove(goal.id)}>
                    삭제
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="flow-note">
          아직 목표가 없습니다. 아래에서 직접 추가하거나 대화로 제품을 찾아 추가할 수 있습니다.
        </p>
      )}
      <details className="goal-add">
        <summary>새 구매 목표 직접 추가</summary>
        <GoalForm onSave={onSave} />
      </details>
    </section>
  );
}

function Proposal({ proposal: p, cats }) {
  const fields = {
    income: "월 소득",
    annualGross: "연간 세전 계약연봉",
    balance: "현재 통장 잔액",
    payday: "월급일",
    savings: "저축",
    reserve: "비상자금",
    debt: "기존 상환액",
    savingsLocked: "저축",
    reserveLocked: "비상자금",
  };
  return (
    <>
      <p>
        <strong>반영할 조건 · {p.month}</strong>
      </p>
      {p.changes.map((c, i) => (
        <p key={i}>
          {c.type === "preference"
            ? `${cats[c.category]} ${won(c.amount)} ${c.operation === "set" ? "설정" : c.operation === "increase" ? "증액" : "감액"} · ${c.month === "always" ? "매달" : c.month + "만"}`
            : c.type === "remove_preference"
              ? `${cats[c.category]} ${c.month === "always" ? "매달" : c.month} 선호 해제`
              : c.type === "profile"
                ? `${fields[c.field]} ${c.field === "payday" ? `매월 ${c.amount}일` : won(c.amount)} ${c.operation === "set" ? "설정" : c.operation === "increase" ? "증액" : "감액"}`
                : c.type === "protect"
                  ? `${fields[c.field]} ${c.enabled ? "금액 유지" : "유지 해제"}`
                  : c.type === "category"
                    ? `${c.merchant} → ${cats[c.category]}`
                    : c.type === "goal"
                      ? `${c.name} 구매 목표 · ${won(c.price)} · 모은 금액 ${won(c.saved)}`
                      : `${c.merchant} 고정비 ${c.confirmed ? "지정" : "해제"}`}
        </p>
      ))}
      {p.after.ready && (
        <>
          <p>
            저축 {p.before.ready ? won(p.before.savings) : "미설정"} →{" "}
            <strong>{won(p.after.savings)}</strong>
          </p>
          <p>
            남는 돈 {p.before.ready ? won(p.before.free) : "미설정"} →{" "}
            <strong>{won(p.after.free)}</strong>
          </p>
          {p.after.shortage > 0 && (
            <p className="notice">
              유지할 금액이 소득보다 {won(p.after.shortage)} 많습니다.
            </p>
          )}
        </>
      )}
    </>
  );
}
function AnalysisPanel({ review, onRetry, onDiscuss }) {
  const usable = review?.status === "complete" && !review.stale;
  return (
    <section className="ai-analysis" aria-label="먼저 살펴볼 지출">
      <div className="section-header">
        <h2>먼저 살펴볼 지출</h2>
        <button
          className="quiet"
          disabled={review?.status === "running"}
          onClick={onRetry}
        >
          다시 분석
        </button>
      </div>
      {review?.status === "running" ? (
        <p role="status">
          거래를 분류하고 소득 대비 부담이 큰 지출을 살펴보고 있습니다.
        </p>
      ) : review?.status === "error" ? (
        <p className="notice" role="status">
          {review.error}
        </p>
      ) : !usable ? (
        <p className="fine">
          거래나 소득이 바뀌면 자동으로 분석합니다. AI 연결이 없으면 설정에서
          먼저 연결해 주세요.
        </p>
      ) : (
        <>
          <p className="analysis-summary">{review.summary}</p>
          <p className="fine">
            {review.scopeNote} · {review.provider} ·{" "}
            {new Date(review.at).toLocaleString("ko-KR")}
            {review.pendingCount > 0
              ? " · 남은 " + review.pendingCount + "건 분류 중"
              : ""}
          </p>
          <div className="analysis-insights">
            {review.insights.map((item, i) => (
              <article key={i}>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
          <h3>미리 납부해도 될 거래</h3>
          <p className="fine">{review.prepaymentNote}</p>
          {(review.prepayments || []).map((t) => (
            <article className="large-expense" key={t.key}>
              <div className="expense-title">
                <strong>{t.merchant}</strong>
                <strong>{won(t.amount)}</strong>
              </div>
              <p className="fine">{t.date} · 미납</p>
              <p>{t.reason}</p>
            </article>
          ))}
          <h3>소득과 비교해 먼저 살펴볼 거래</h3>
          {review.largeExpenses.length ? (
            review.largeExpenses.map((t) => (
              <article className="large-expense" key={t.key}>
                <div className="expense-title">
                  <strong>{t.merchant}</strong>
                  <strong>{won(t.amount)}</strong>
                </div>
                <p className="fine">
                  {t.date} · 월 실수령의 {t.incomePercent}% · {labels[t.status]}
                </p>
                <p>{t.reason}</p>
                <p className="fine">
                  {t.nextStep === "spending_review"
                    ? "이미 납부된 거래입니다. 추가 결제 없이 지출 패턴을 점검합니다."
                    : t.nextStep === "check_payment"
                      ? "납부·잔여 원금부터 확인해야 합니다. 할부 전환 가능 여부는 미확인입니다."
                      : "할부 전환 가능 여부와 실제 수수료를 확인한 뒤 일시불 유지와 비교할 수 있습니다."}
                </p>
                <button className="quiet" onClick={() => onDiscuss(t)}>
                  이 거래를 대화로 살펴보기
                </button>
              </article>
            ))
          ) : (
            <p className="fine">
              현재 분석에서 별도로 제시할 거래가 없습니다. 소득 미입력 시 소득
              대비 판단은 보류합니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function BankAccounts({ state }) {
  if (!state.accountSummary.connected)
    return (
      <section className="bank-overview">
        <h2>계좌</h2>
        <p className="flow-note">아직 연결된 계좌가 없습니다. 연결과 설정에서 CODEF 정보를 입력하면 잔액과 입출금을 볼 수 있습니다.</p>
      </section>
    );
  return (
    <section className="bank-overview" aria-labelledby="bank-title">
      <div className="section-header">
        <h2 id="bank-title">계좌</h2>
        <span className="fine">
          {state.accountSummary.updatedAt
            ? new Date(state.accountSummary.updatedAt).toLocaleString("ko-KR")
            : ""}
        </span>
      </div>
      <div className="bank-total">
        <span>출금 가능</span>
        <strong>{won(state.accountSummary.availableCash)}</strong>
        <small>전체 잔액 {won(state.accountSummary.totalBalance)}</small>
      </div>
      <div className="account-list">
        {state.accounts.map((account) => (
          <div className="account-row" key={account.id}>
            <span>
              {account.name} <small>{account.display}</small>
            </span>
            <strong>{won(account.available)}</strong>
          </div>
        ))}
      </div>
      {!!state.bankTransactions.length && (
        <details>
          <summary>최근 입출금</summary>
          <div className="bank-transactions">
            {state.bankTransactions.slice(0, 8).map((transaction) => (
              <div key={transaction.id}>
                <span>
                  {transaction.description} <small>{transaction.date}</small>
                </span>
                <strong className={transaction.direction}>
                  {transaction.direction === "in" ? "+" : "−"}
                  {won(transaction.amount)}
                </strong>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
function App() {
  const [state, setState] = useState(null),
    [session, setSession] = useState(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState(location.hash.slice(1) || "plan"),
    [month, setMonth] = useState(nowMonth()),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [detail, setDetail] = useState(null),
    [comparison, setComparison] = useState(null),
    [codex, setCodex] = useState(null),
    [login, setLogin] = useState(""),
    [bankMethod, setBankMethod] = useState("id"),
    [certificateType, setCertificateType] = useState("1"),
    [quickCredentialType, setQuickCredentialType] = useState("account"),
    [quickEditTypes, setQuickEditTypes] = useState({}),
    [revealedAccounts, setRevealedAccounts] = useState([]),
    [revealedBankConnection, setRevealedBankConnection] = useState(false),
    [toast, setToast] = useState(null),
    [connectionProvider, setConnectionProvider] = useState("codex");
  const toastTimer = useRef();
  const navigate = (t) => {
    setTab(t);
    location.hash = t;
  };
  const refresh = async (waitForAnalysis = false) => {
    let data = await api("/overview?month=" + month);
    setState(data);
    if (!waitForAnalysis) return data;
    const deadline = Date.now() + 180000;
    while (data.aiReview?.status === "running") {
      if (Date.now() >= deadline)
        throw Error("분석이 오래 걸리고 있습니다. 잠시 후 다시 확인하세요.");
      await new Promise((resolve) => setTimeout(resolve, 800));
      data = await api("/overview?month=" + month);
      setState(data);
    }
    if (data.aiReview?.status === "error")
      throw Error(data.aiReview.error || "분석에 실패했습니다.");
    return data;
  };
  useEffect(() => {
    let alive = true;
    api("/session")
      .then((s) => {
        if (!alive) return;
        token = s.token;
        setSession(s);
        setConnectionProvider(s.connection.provider);
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => refresh().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [session, month]);
  useEffect(() => {
    const onHash = () => setTab(location.hash.slice(1) || "plan");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (detail) {
      const d = document.querySelector("#transaction-detail");
      d.showModal();
    }
  }, [detail]);
  async function action(fn, messages = {}) {
    setError("");
    clearTimeout(toastTimer.current);
    setToast({
      type: "pending",
      message: messages.pending || "처리 중입니다.",
    });
    try {
      const result = await fn();
      setToast({
        type: "success",
        message: messages.success || "완료되었습니다.",
      });
      toastTimer.current = setTimeout(() => setToast(null), 3000);
      return result;
    } catch (e) {
      setError(e.message);
      setToast({
        type: "error",
        message: `처리하지 못했습니다. ${e.message}`,
      });
      toastTimer.current = setTimeout(() => setToast(null), 5000);
    }
  }
  const tool = async (name, args) => {
    await api("/tools/" + name, args);
    await refresh();
    return true;
  };
  async function send(e) {
    e.preventDefault();
    if (busy || !message.trim()) return;
    setBusy(true);
    await action(async () => {
      await api("/chat", { message: message.trim(), month });
      setMessage("");
      await refresh();
    });
    setBusy(false);
  }
  async function connect(e) {
    e.preventDefault();
    await action(async () => {
      const p = Object.fromEntries(new FormData(e.target));
      const c = await api("/connection", p);
      setSession((s) => ({ ...s, connection: c }));
      e.target.elements.key.value = "";
    });
  }
  async function connectBank(e) {
    e.preventDefault();
    await action(async () => {
      const form = e.currentTarget,
        data = new FormData(form),
        bankConnection = await api("/bank/connection", {
          environment: data.get("environment"),
          clientId: data.get("clientId"),
          clientSecret: data.get("clientSecret"),
          connectedId: data.get("connectedId"),
          publicKey: data.get("publicKey"),
          birthDate: "",
          organizations: [],
        });
      setSession((current) => ({ ...current, bankConnection }));
      form.reset();
      form.querySelectorAll('input[data-connection-secret]').forEach((input) => {
        input.type = "password";
      });
      setRevealedBankConnection(false);
    });
  }
  async function toggleBankConnection(form) {
    if (!revealedBankConnection) {
      const saved = await api("/bank/connection/reveal", {});
      for (const [name, value] of Object.entries(saved)) {
        const field = form.elements.namedItem(name);
        if (field) field.value = value;
      }
      form.querySelectorAll('input[data-connection-secret]').forEach((input) => {
        input.type = "text";
      });
    } else {
      form.querySelectorAll("[data-connection-secret]").forEach((input) => {
        input.value = "";
        if (input.tagName === "INPUT") input.type = "password";
      });
    }
    setRevealedBankConnection((current) => !current);
  }
  async function registerBank(e) {
    e.preventDefault();
    await action(async () => {
      const form = e.currentTarget,
        data = new FormData(form),
        common = {
          organization: data.get("organization"),
          birthDate: data.get("birthDate") || "",
        };
      let bankConnection;
      if (bankMethod === "certificate") {
        bankConnection = await api("/bank/register", {
          ...common,
          method: "certificate",
          certType: certificateType,
          derFile: await readCertificateFile(data.get("derFile")),
          keyFile: await readCertificateFile(data.get("keyFile")),
          certFile: await readCertificateFile(data.get("certFile")),
          certificatePassword: data.get("certificatePassword"),
        });
      } else if (bankMethod === "quick") {
        bankConnection = await api("/bank/quick", {
          organization: common.organization,
          credentialType: quickCredentialType,
          alias: data.get("alias") || "",
          id: data.get("quickId") || "",
          password: data.get("quickPassword") || "",
          fastId: data.get("fastId") || "",
          fastPassword: data.get("fastPassword") || "",
          account: data.get("account") || "",
          accountPassword: data.get("accountPassword") || "",
          identity: data.get("identity") || "",
        });
      } else {
        bankConnection = await api("/bank/register", {
          ...common,
          method: "id",
          loginId: data.get("loginId"),
          loginPassword: data.get("loginPassword"),
        });
      }
      setSession((current) => ({ ...current, bankConnection }));
      form
        .querySelectorAll('input[type="password"], input[type="file"]')
        .forEach((input) => (input.value = ""));
    });
  }
  async function syncBank(e) {
    e.preventDefault();
    await action(() =>
      syncBankData(Object.fromEntries(new FormData(e.currentTarget))),
    );
  }
  async function syncBankData(data) {
    const result = await api("/bank/sync", data);
    setSession((current) => ({
      ...current,
      bankConnection: result.status,
    }));
    setState(result.overview);
    if (result.warnings?.length) throw Error(result.warnings.join(" · "));
    return result;
  }
  async function updateQuickBank(e) {
    e.preventDefault();
    await action(async () => {
      const form = e.currentTarget,
        data = Object.fromEntries(new FormData(form)),
        bankConnection = await api("/bank/quick/update", data);
      setSession((current) => ({ ...current, bankConnection }));
      setQuickEditTypes({});
      form.querySelectorAll("input[data-secret]").forEach((input) => {
        input.value = "";
        input.type = "password";
      });
      setRevealedAccounts((current) =>
        current.filter((id) => id !== data.connectionId),
      );
    });
  }
  async function toggleQuickCredentials(connection, button) {
    const form = button.closest("form"),
      hidden = !revealedAccounts.includes(connection.id);
    if (hidden) {
      const secrets = await api(`/bank/quick/${connection.id}/reveal`, {});
      for (const [name, value] of Object.entries(secrets)) {
        const input = form.elements.namedItem(name);
        if (input && value) input.value = value;
      }
    }
    form.querySelectorAll("input[data-secret]").forEach((input) => {
      input.type = hidden ? "text" : "password";
    });
    setRevealedAccounts((current) =>
      hidden
        ? [...current, connection.id]
        : current.filter((id) => id !== connection.id),
    );
  }
  async function disconnectQuick(connection) {
    if (!window.confirm(`${connection.alias || connection.display} 연결을 끊을까요? 저장된 거래내역은 유지됩니다.`)) return;
    await action(async () => {
      const bankConnection = await api(
        `/bank/quick/${connection.id}`,
        undefined,
        "DELETE",
      );
      setSession((current) => ({ ...current, bankConnection }));
      setRevealedAccounts((current) =>
        current.filter((id) => id !== connection.id),
      );
    });
  }
  useEffect(() => {
    setComparison(null);
  }, [month, JSON.stringify(state?.plan)]);
  const cats = session?.categories || {};
  const plan = state?.plan;
  const analysis = state?.analysis;
  const ledgerRows = state
    ? [
        ...state.transactions.map((transaction) => ({
          ...transaction,
          kind: "card",
          title: transaction.merchant,
        })),
        ...state.bankTransactions.map((transaction) => ({
          ...transaction,
          kind: "bank",
          title: transaction.description,
          account: state.accounts.find(
            (account) => account.id === transaction.accountId,
          ),
        })),
      ]
        .filter((row) => row.date.startsWith(month))
        .filter((row) => row.title.toLowerCase().includes(query.toLowerCase()))
        .filter((row) =>
          status === "all"
            ? true
            : status === "bank" || status === "card"
              ? row.kind === status
              : status === "in" || status === "out"
                ? row.kind === "bank" && row.direction === status
                : row.kind === "card" && row.status === status,
        )
        .sort((a, b) =>
          `${b.date}${b.time || ""}`.localeCompare(`${a.date}${a.time || ""}`),
        )
    : [];
  return (
    <div className="shell">
      <a className="skip" href="#content">
        본문으로 이동
      </a>
      <aside className="rail">
        <a
          href="#plan"
          className="brand"
          aria-label="여유 홈"
          onClick={() => navigate("plan")}
        >
          <span className="brand-name">여유</span>
          <span className="brand-role">개인 재무 에이전트</span>
        </a>
        <nav aria-label="주 메뉴">
          {[
            ["plan", "이번 달 계획"],
            ["spending", "지출 살펴보기"],
            ["settings", "연결과 설정"],
          ].map(([id, name]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              {name}
            </button>
          ))}
          <button
            className="chat-jump"
            onClick={() => {
              if (tab !== "plan") navigate("plan");
              setTimeout(() => {
                document.querySelector(".chat")?.scrollIntoView({ block: "start" });
                document.querySelector("#message")?.focus({ preventScroll: true });
              }, 0);
            }}
          >
            대화
          </button>
        </nav>
        <div className="rail-bottom">
          <span className="dot" /> 개인 PC에서 실행 중
          <p>
            자료는 이 기기에만 저장됩니다.
            <br />
            계좌 {session?.bankConnection?.connected ? "연결됨" : "연결 안 됨"}
          </p>
        </div>
      </aside>
      <div className="body">
        <header className="topbar">
          <label className="month-label">
            계획 월
            <input
              aria-label="계획 월"
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </label>
          <button
            className="quiet"
            onClick={() =>
              action(
                async () => {
                  if (session?.bankConnection?.ready)
                    await syncBankData({
                      from: defaultBankFrom(),
                      to: inputDate(),
                    });
                  await refresh(true);
                },
                {
                  pending: "카드와 연결 계좌 자료를 가져와 분석하고 있습니다.",
                  success: "자료와 분석을 최신 상태로 반영했습니다.",
                },
              )
            }
          >
            자료 새로 읽기
          </button>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")} aria-label="오류 닫기">
              닫기
            </button>
          </div>
        )}
        {toast && (
          <div
            className={`action-toast ${toast.type}`}
            role={toast.type === "error" ? "alert" : "status"}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <strong>
              {toast.type === "pending"
                ? "진행 중"
                : toast.type === "success"
                  ? "완료"
                  : "실패"}
            </strong>
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} aria-label="알림 닫기">
              닫기
            </button>
          </div>
        )}
        <main id="content">
          <h1 className="sr-only">
            {tab === "spending"
              ? "지출"
              : tab === "settings"
                ? "연결과 설정"
                : "이번 달 계획"}
          </h1>
          {!state ? (
            <p role="status">저장된 자료를 읽고 있습니다.</p>
          ) : (
            <>
              {tab === "spending" && (
                <AnalysisPanel
                  review={state.aiReview}
                  onRetry={() =>
                    action(async () => {
                      await api("/analysis", { month });
                      await refresh(true);
                    }, {
                      pending: "거래를 다시 분석하고 있습니다.",
                      success: "분석을 완료했습니다.",
                    })
                  }
                  onDiscuss={(t) => {
                    navigate("plan");
                    setMessage(
                      `${t.date} ${t.merchant} ${won(t.amount)} 거래를 소득과 예산 기준으로 자세히 분석해줘. 납부 상태와 확인된 할부 조건만 근거로 사용해줘.`,
                    );
                    setTimeout(
                      () => document.querySelector("#message")?.focus(),
                      0,
                    );
                  }}
                />
              )}
              {tab === "plan" && (
                <div className="plan-layout">
                  <div>
                    <section className="summary">
                      <p className="section-label">이번 달 배분</p>
                      {plan.ready ? (
                        <>
                          <div className="lead-amount">
                            {won(plan.free)}
                            <span>
                              {plan.shortage
                                ? "필수 예산 부족"
                                : "배분 후 남는 돈"}
                            </span>
                          </div>
                          <div className="summary-lines">
                            {!!state.profile.annualGross && (
                              <span>
                                계약연봉 세전 {won(state.profile.annualGross)}
                              </span>
                            )}
                            <span>
                              {plan.incomeEstimated ? "예상 실수령" : "실수령"}{" "}
                              {won(plan.income)}
                            </span>
                            <span>
                              {state.accountSummary.connected
                                ? `연결 계좌 출금 가능 ${won(state.accountSummary.availableCash)}`
                                : `현재 잔액 ${won(state.profile.balance)}`}
                            </span>
                            {state.profile.payday && (
                              <span>월급일 매월 {state.profile.payday}일</span>
                            )}
                            <span>고정비 {won(plan.fixedTotal)}</span>
                            <span>기존 상환 {won(plan.debt)}</span>
                          </div>
                          {plan.provisional && (
                            <p className="notice">
                              {plan.incomeEstimated
                                ? `${plan.incomeEstimate.year}년 기준 예상값 · ${plan.incomeEstimate.assumption} · 실제 급여 입력 시 자동 대체`
                                : "전체 월 내역이 없어 임시 배분입니다. 현재 확인된 지출만 반영했습니다."}
                            </p>
                          )}
                          {plan.conflicts?.map((t) => (
                            <p className="notice" key={t}>
                              {t}
                            </p>
                          ))}
                          {plan.unconfirmed > 0 && (
                            <p className="notice">
                              고정비 후보 {plan.unconfirmed}곳은 확인 전이라
                              고정비로 확정하지 않았습니다.
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <h2>월 소득 입력</h2>
                          <p className="flow-note">
                            아래에 월 소득을 입력하면 고정비와 생활비를 나눠 계산합니다.
                          </p>
                          {state.profile && (
                            <p className="summary-lines">
                              {!!state.profile.annualGross && (
                                <span>
                                  계약연봉 세전 {won(state.profile.annualGross)}
                                </span>
                              )}
                              <span>현재 잔액 {won(state.profile.balance)}</span>
                              {state.profile.payday && (
                                <span>월급일 매월 {state.profile.payday}일</span>
                              )}
                            </p>
                          )}
                        </>
                      )}
                    </section>
                    <BankAccounts state={state} />
                    <details className="profile" open={!state.profile}>
                      <summary>
                        현금 흐름과 목표 {state.profile ? "수정" : "입력"}
                      </summary>
                      <form
                        key={JSON.stringify(state.profile)}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = Object.fromEntries(new FormData(e.target));
                          action(() =>
                            tool("update_profile", {
                              savingsLocked: !!state.profile?.savingsLocked,
                              reserveLocked: !!state.profile?.reserveLocked,
                              income: Number(f.income),
                              annualGross: Number(f.annualGross),
                              balance: Number(f.balance),
                              payday: f.payday === "" ? null : Number(f.payday),
                              debt: Number(f.debt),
                              savings:
                                f.savings === "" ? null : Number(f.savings),
                              reserve:
                                f.reserve === "" ? null : Number(f.reserve),
                            }),
                          );
                        }}
                      >
                        <div className="form-grid">
                          <Amount
                            label="연간 세전 계약연봉"
                            name="annualGross"
                            value={state.profile?.annualGross || null}
                            optional
                            placeholder="예: 32000000"
                          />
                          <Amount
                            label="월 실수령 소득"
                            name="income"
                            value={state.profile?.income || null}
                            optional
                            placeholder="비우면 연봉으로 추정"
                          />
                          <Amount
                            label="현재 통장 잔액"
                            name="balance"
                            value={state.profile?.balance ?? 0}
                          />
                          <label>
                            월급일
                            <span className="input-unit">
                              <input
                                name="payday"
                                type="number"
                                min="1"
                                max="31"
                                step="1"
                                defaultValue={state.profile?.payday ?? ""}
                                placeholder="예: 5"
                              />
                              <span>일</span>
                            </span>
                          </label>
                          <Amount
                            label="기존 대출·할부 월 상환액"
                            name="debt"
                            value={state.profile?.debt ?? 0}
                          />
                          <Amount
                            label="저축 목표"
                            name="savings"
                            value={state.profile?.savings}
                            optional
                          />
                          <Amount
                            label="비상자금 적립"
                            name="reserve"
                            value={state.profile?.reserve}
                            optional
                          />
                        </div>
                        <p className="flow-note">
                          저축과 비상자금을 비우면 소득의 20%, 10%로 시작합니다.
                          카드 할부는 거래에서 이미 반영되므로 상환액에 다시 넣지
                          마세요.
                        </p>
                        <button className="primary">정보 반영</button>
                      </form>
                    </details>
                    {plan.ready && (
                      <section className="allocations">
                        <div className="section-header">
                          <h2>월 예산</h2>
                        </div>
                        <p className="flow-note">
                          {plan.baseMonths.join(", ")} 지출을 바탕으로 고정비와 내가
                          정한 예산을 먼저 채우고 남는 금액을 나눴습니다.
                        </p>
                        <div className="allocation-row">
                          <div>
                            저축{" "}
                            <small>
                              {plan.defaults.savings
                                ? "자동 제안"
                                : "설정한 목표"}
                            </small>
                          </div>
                          <strong>{won(plan.savings)}</strong>
                          <span className="fine">
                            목표 {won(plan.targetSavings)}
                          </span>
                        </div>
                        <div className="allocation-row">
                          <div>비상자금</div>
                          <strong>{won(plan.reserve)}</strong>
                          <span className="fine">
                            목표 {won(plan.targetReserve)}
                          </span>
                        </div>
                        {plan.allocations.map((a) => (
                          <div className="allocation-row" key={a.category}>
                            <div>
                              {a.label}{" "}
                              {a.protected && (
                                <small className="protected">
                                  내가 정한 예산
                                </small>
                              )}
                            </div>
                            <strong>{won(a.amount)}</strong>
                            <span className="fine">
                              {a.fixedBudget > 0
                                ? "고정비 " + won(a.fixedBudget) + " 별도 · "
                                : ""}
                              변동 지출 {won(a.actual - a.fixedActual)}
                              {a.actual - a.fixedActual > a.amount
                                ? " · 예산 초과"
                                : ""}
                            </span>
                          </div>
                        ))}
                        {!plan.allocations.length && (
                          <p className="empty">
                            거래를 가져오면 항목별 생활비를 제안합니다.
                          </p>
                        )}
                      </section>
                    )}
                    <section className="preferences">
                      <h2>내 지출 기준</h2>
                      {state.preferences.length ? (
                        state.preferences.map((p) => (
                          <div
                            className="preference"
                            key={p.category + p.month}
                          >
                            <p>
                              {cats[p.category]}{" "}
                              <strong>{won(p.amount)}</strong>
                              <span>
                                {p.month === "always" ? "매달" : p.month + "만"}{" "}
                                {p.note && "· " + p.note}
                              </span>
                            </p>
                            <button
                              className="quiet"
                              onClick={() =>
                                action(() =>
                                  tool("remove_preference", {
                                    category: p.category,
                                    month: p.month,
                                  }),
                                )
                              }
                            >
                              해제
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="flow-note">
                          아직 없습니다. 대화에서 "매달 술값 30만원"처럼 말하면 여기에
                          반영됩니다.
                        </p>
                      )}
                      <details>
                        <summary>직접 지출 선호 입력</summary>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const p = Object.fromEntries(
                              new FormData(e.target),
                            );
                            action(() =>
                              tool("set_preference", {
                                ...p,
                                amount: Number(p.amount),
                                month: p.month === "current" ? month : p.month,
                              }),
                            );
                          }}
                        >
                          <div className="form-grid">
                            <label>
                              지출 항목
                              <select name="category">
                                {Object.entries(cats).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Amount label="항목의 총 월 예산" name="amount" />
                            <label>
                              적용 기간
                              <select name="month">
                                <option value="always">매달 유지</option>
                                <option value="current">선택한 달만</option>
                              </select>
                            </label>
                            <label>
                              이유
                              <input
                                name="note"
                                maxLength="300"
                                placeholder="예: 친구들과 주말 약속"
                              />
                            </label>
                          </div>
                          <button>계획에 반영</button>
                        </form>
                      </details>
                    </section>
                    <PurchaseGoals
                      goals={state.goals}
                      plan={plan}
                      onSave={(goal) =>
                        action(() => tool("set_purchase_goal", goal))
                      }
                      onRemove={(id) =>
                        action(() => tool("remove_purchase_goal", { id }))
                      }
                      onDiscuss={(goal) => {
                        setMessage(
                          `${goal.name} ${won(goal.price)} 구매 목표가 있고 지금 ${won(goal.saved)}을 따로 모았어. 현재 지출과 배분을 기준으로 무리 없이 살 수 있는 시점과 줄일 수 있는 지출을 분석해줘. 확인된 할부 조건이 없으면 수수료나 개월 수를 지어내지 마.`,
                        );
                        setTimeout(
                          () => document.querySelector("#message")?.focus(),
                          0,
                        );
                      }}
                    />
                    <details className="purchase">
                      <summary>일시불·할부 비교</summary>
                      <p className="flow-note">
                        카드사에서 확인한 수수료만 입력하세요. 비운 개월 수는 비교에서
                        뺍니다.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = Object.fromEntries(new FormData(e.target));
                          action(async () =>
                            setComparison(
                              await api("/tools/compare_purchase", {
                                month,
                                amount: Number(f.amount),
                                options: [3, 6, 12]
                                  .filter((n) => f["fee" + n] !== "")
                                  .map((n) => ({
                                    months: n,
                                    fee: Number(f["fee" + n]),
                                  })),
                              }),
                            ),
                          );
                        }}
                      >
                        <div className="form-grid">
                          <Amount label="구매 예정 금액" name="amount" />
                          {[3, 6, 12].map((n) => (
                            <Amount
                              key={n}
                              label={n + "개월 총 수수료"}
                              name={"fee" + n}
                              optional
                              placeholder="조건 미확인"
                            />
                          ))}
                        </div>
                        <button disabled={!plan.ready}>일시불·할부 비교</button>
                      </form>
                      {comparison && (
                        <div aria-live="polite">
                          <p className="notice">
                            {comparison.provisional
                              ? "자료가 부족해 비교만 표시합니다. 추천은 보류합니다."
                              : comparison.preferred
                                ? comparison.preferred === 1
                                  ? "입력한 월 예산에서는 일시불을 우선 검토할 수 있습니다."
                                  : comparison.preferred +
                                    "개월: 월 예산 안에서 수수료가 가장 적은 조건입니다."
                                : "입력한 조건에서는 구매 연기나 예산 조정이 필요합니다."}
                          </p>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>방식</th>
                                  <th>월 부담</th>
                                  <th>총비용</th>
                                  <th>배분 후 잔여</th>
                                </tr>
                              </thead>
                              <tbody>
                                {comparison.options.map((o, i) => (
                                  <tr key={i}>
                                    <td>
                                      {o.months === 1
                                        ? "일시불"
                                        : o.months + "개월"}
                                    </td>
                                    <td>{won(o.monthly)}</td>
                                    <td>{won(o.total)}</td>
                                    <td>{won(o.remaining)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="fine">{comparison.note}</p>
                        </div>
                      )}
                    </details>
                  </div>
                  <section className="chat" aria-label="재무 대화">
                    <div className="section-header">
                      <h2>대화로 조정</h2>
                      <span className="fine">
                        {session.connection.provider === "codex"
                          ? "Codex 구독 · 웹검색"
                          : session.connection.provider + " API · 웹검색"}
                      </span>
                    </div>
                    <div className="messages" aria-live="polite">
                      {state.messages.length ? (
                        state.messages.map((m) => (
                          <article key={m.id} className={"message " + m.role}>
                            <span className="message-label">
                              {m.role === "user" ? "나" : "재무 도우미"}
                            </span>
                            <p>{m.text}</p>
                            {m.proposal && (
                              <div className="proposal">
                                <Proposal proposal={m.proposal} cats={cats} />
                                <button
                                  disabled={m.applied}
                                  onClick={() =>
                                    action(async () => {
                                      await api(
                                        "/proposals/" + m.id + "/apply",
                                        {},
                                      );
                                      await refresh();
                                    })
                                  }
                                >
                                  {m.applied
                                    ? "계획에 반영됨"
                                    : "이 조건으로 재배분"}
                                </button>
                                {!m.applied && (
                                  <button
                                    className="quiet"
                                    onClick={() =>
                                      action(async () => {
                                        await api(
                                          "/proposals/" + m.id + "/preview",
                                          {},
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    변경안 다시 계산
                                  </button>
                                )}
                              </div>
                            )}
                          </article>
                        ))
                      ) : (
                        <div className="chat-empty">
                          <p>예시</p>
                          {[
                            "매달 술값은 30만원 정도 쓸 것 같아",
                            "내 지출에서 줄일 만한 부분을 알려줘",
                            "고정비로 보이는 내역을 설명해줘",
                          ].map((t) => (
                            <button key={t} onClick={() => setMessage(t)}>
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                      {busy && (
                        <p role="status">거래와 계획을 확인하고 있습니다…</p>
                      )}
                    </div>
                    <form onSubmit={send}>
                      <label className="sr-only" htmlFor="message">
                        계획에 대한 요청
                      </label>
                      <textarea
                        id="message"
                        disabled={busy}
                        value={message}
                        maxLength="4000"
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="제품을 찾아 목표로 추가해줘"
                        rows="3"
                      />
                      <div className="chat-actions">
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => navigate("settings")}
                        >
                          AI 연결 설정
                        </button>
                        <button
                          className="primary"
                          disabled={busy || !message.trim()}
                        >
                          {busy ? "분석 중" : "보내기"}
                        </button>
                      </div>
                    </form>
                    <p className="flow-note">
                      거래·소득·최근 대화가 선택한 AI에 전달됩니다. 제품 검색은
                      웹검색을 씁니다.
                    </p>
                  </section>
                </div>
              )}
              {tab === "spending" && (
                <>
                  <section className="spend-summary">
                    <div>
                      <p className="section-label">
                        {analysis.complete
                          ? "조회 기간 전체 자료"
                          : "확보된 자료 범위"}
                      </p>
                      <div className="lead-amount">
                        {won(analysis.total)}
                        <span>
                          취소·거절 제외 승인금액 · {analysis.count}건
                        </span>
                      </div>
                    </div>
                    <p className="flow-note">
                      {analysis.complete
                        ? "이 달 전체 내역이 확인된 자료입니다."
                        : "가져온 자료만 집계했습니다. 월 전체 합계나 전월 비교로 보기엔 부족할 수 있습니다."}
                      {analysis.partial ? " 부분취소 거래는 남은 금액을 확인하세요." : ""}
                    </p>
                  </section>
                  {session.bankConnection.ready && (
                    <section className="account-cashflow" aria-labelledby="cashflow-title">
                      <div className="section-header">
                        <h2 id="cashflow-title">계좌 현금흐름</h2>
                        <span className="fine">{month}</span>
                      </div>
                      {state.accountSummary.connected ? (
                        <>
                          <div className="cashflow-values">
                            <p>
                              <span>입금</span>
                              <strong className="in">+{won(state.bankCashflow.incoming)}</strong>
                            </p>
                            <p>
                              <span>출금</span>
                              <strong className="out">−{won(state.bankCashflow.outgoing)}</strong>
                            </p>
                            <p>
                              <span>순변동</span>
                              <strong>{state.bankCashflow.net >= 0 ? "+" : "−"}{won(Math.abs(state.bankCashflow.net))}</strong>
                            </p>
                          </div>
                          <p className="flow-note">
                            계좌이체·카드대금이 포함된 실제 통장 움직임입니다. 카드 승인 지출과는 합치지 않아 중복을 막고, AI가 급여와 반복 이체를 함께 살펴봅니다.
                          </p>
                          {!!state.bankCashflow.count && (
                            <details>
                              <summary>이 달 입출금 {state.bankCashflow.count}건</summary>
                              <div className="bank-transactions">
                                {state.bankTransactions
                                  .filter((transaction) => transaction.date.startsWith(month))
                                  .slice(0, 20)
                                  .map((transaction) => (
                                    <div key={transaction.id}>
                                      <span>
                                        {transaction.description} <small>{transaction.date}</small>
                                      </span>
                                      <strong className={transaction.direction}>
                                        {transaction.direction === "in" ? "+" : "−"}{won(transaction.amount)}
                                      </strong>
                                    </div>
                                  ))}
                              </div>
                            </details>
                          )}
                        </>
                      ) : (
                        <div className="cashflow-empty">
                          <p>계좌는 연결됐지만 입출금 자료를 아직 가져오지 못했습니다.</p>
                          <button className="quiet" onClick={() => navigate("settings")}>동기화 설정으로 이동</button>
                        </div>
                      )}
                    </section>
                  )}
                  <div className="spend-grid">
                    <section>
                      <h2>항목별 지출</h2>
                      {Object.entries(analysis.totals)
                        .filter(([, n]) => n > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => (
                          <div className="category-row" key={k}>
                            <span>{cats[k]}</span>
                            <meter
                              aria-label={cats[k] + " 비중"}
                              min="0"
                              max={Math.max(analysis.total, 1)}
                              value={v}
                            />
                            <strong>{won(v)}</strong>
                            <small>
                              {((v / analysis.total) * 100).toFixed(1)}%
                            </small>
                          </div>
                        ))}
                      {!analysis.count && (
                        <p className="empty">선택한 달의 거래가 없습니다.</p>
                      )}
                    </section>
                    <section>
                      <h2>고정비로 보이는 결제</h2>
                      {analysis.candidates.filter((c) => !c.dismissed)
                        .length ? (
                        analysis.candidates
                          .filter((c) => !c.dismissed)
                          .map((c) => (
                            <div className="candidate" key={c.merchant}>
                              <strong>{c.merchant}</strong>
                              <p>
                                {won(c.amount)} · {c.reason}
                              </p>
                              <p className="fine">
                                최근 이용일 {c.lastDate} ·{" "}
                                {c.confirmed
                                  ? "고정비로 반영 중"
                                  : "확인 전 후보"}
                              </p>
                              <button
                                onClick={() =>
                                  action(() =>
                                    tool("confirm_recurring", {
                                      merchant: c.merchant,
                                      confirmed: !c.confirmed,
                                    }),
                                  )
                                }
                              >
                                {c.confirmed ? "고정비 해제" : "고정비로 반영"}
                              </button>
                              {!c.confirmed && (
                                <button
                                  className="quiet"
                                  onClick={() =>
                                    action(() =>
                                      tool("confirm_recurring", {
                                        merchant: c.merchant,
                                        confirmed: false,
                                      }),
                                    )
                                  }
                                >
                                  고정비 아님
                                </button>
                              )}
                            </div>
                          ))
                      ) : (
                        <p className="flow-note">
                          3개월 이상 비슷한 날짜와 금액으로 결제된 곳이 있으면 여기에
                          보입니다. 거래 상세에서 직접 지정할 수도 있습니다.
                        </p>
                      )}
                    </section>
                  </div>
                  <section>
                    <div className="section-header">
                      <h2>거래 장부</h2>
                      <span className="fine">카드 승인과 계좌 입출금을 날짜순으로 봅니다</span>
                    </div>
                    <div className="filters">
                      <label>
                        내역 검색
                        <input
                          type="search"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <label>
                        내역 필터
                        <select
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                        >
                          <option value="all">전체</option>
                          <option value="in">입금</option>
                          <option value="out">출금</option>
                          <option value="paid">선납·납부 확인</option>
                          <option value="unpaid">미납</option>
                          <option value="bank">계좌</option>
                          <option value="card">카드</option>
                        </select>
                      </label>
                    </div>
                    <div className="table-scroll">
                      <table className="ledger">
                        <thead>
                          <tr>
                            <th>일자</th>
                            <th>내역</th>
                            <th>구분</th>
                            <th>금액</th>
                            <th>상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerRows.map((t) => (
                              <tr key={`${t.kind}:${t.id}`}>
                                <td>{t.date.slice(5)}{t.time ? <small> {t.time.slice(0, 2)}:{t.time.slice(2, 4)}</small> : null}</td>
                                <td>
                                  {t.kind === "card" ? (
                                    <button
                                      className="merchant"
                                      onClick={() => setDetail(t)}
                                    >
                                      {t.title}
                                    </button>
                                  ) : (
                                    <span>{t.title}</span>
                                  )}
                                  <small className="ledger-source">
                                    {t.kind === "card"
                                      ? "카드"
                                      : `${session.bankOptions.find((bank) => bank.value === t.account?.organization)?.label || "계좌"} ${t.account?.display || ""}`}
                                  </small>
                                </td>
                                <td>
                                  {t.kind === "card" ? <div className="classification">
                                    <select
                                      aria-label={t.merchant + " 항목"}
                                      value={t.category}
                                      onChange={(e) =>
                                        action(() =>
                                          tool("categorize_transactions", {
                                            ids: [t.id],
                                            source: t.source,
                                            category: e.target.value,
                                          }),
                                        )
                                      }
                                    >
                                      {Object.entries(cats).map(([k, v]) => (
                                        <option key={k} value={k}>
                                          {v}
                                        </option>
                                      ))}
                                    </select>
                                    <small title={t.aiCategory?.reason || ""}>
                                        {t.categoryOrigin === "correction"
                                          ? "정정 반영"
                                          : t.aiCategory
                                            ? t.aiCategory.confidence === "low"
                                              ? "AI 판단 보류"
                                              : t.aiCategory.confidence ===
                                                  "medium"
                                                ? "AI 추정"
                                                : "AI 분류"
                                            : "분석 대기"}
                                    </small>
                                  </div> : <span>{t.direction === "in" ? "입금" : "출금"}</span>}
                                </td>
                                <td className={`numeric ${t.kind === "bank" ? t.direction : ""}`}>
                                  {t.kind === "bank" ? (t.direction === "in" ? "+" : "−") : ""}{won(t.amount)}
                                </td>
                                <td className={"status " + (t.kind === "bank" ? t.direction : t.status)}>
                                  {t.kind === "bank" ? (t.direction === "in" ? "입금" : "출금") : labels[t.status]}
                                </td>
                              </tr>
                            ))}
                          {!ledgerRows.length && (
                            <tr><td colSpan="5" className="empty">조건에 맞는 내역이 없습니다.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {tab === "settings" && (
                <div className="settings">
                  <section>
                    <h2>계좌 연결</h2>
                    <p className="flow-note">
                      CODEF 읽기 권한으로 계좌 잔액과 입출금을 가져와 이 기기에 저장합니다.
                    </p>
                    <p className="connection-status">
                      {session.bankConnection.ready
                        ? "계좌가 연결되어 있습니다"
                        : session.bankConnection.connected
                          ? "CODEF 키는 저장됐고, 아래에서 은행 인증을 마치면 됩니다"
                          : "아직 연결하지 않았습니다"}
                      {session.bankConnection.organizations?.length
                        ? ` · 은행 ${session.bankConnection.organizations.length}곳`
                        : ""}
                      {session.bankConnection.accountCount
                        ? ` · 계좌 ${session.bankConnection.accountCount}개`
                        : ""}
                      {session.bankConnection.methods?.length
                        ? ` · ${session.bankConnection.methods.map((method) => bankMethodLabels[method] || method).join(" + ")}`
                        : ""}
                    </p>
                    <div className="connected-account-summary" aria-label="연결된 계좌 요약">
                      <div className="section-header">
                        <h3>연결된 계좌</h3>
                        <span className="fine">
                          {state?.accountSummary?.updatedAt
                            ? `최근 동기화 ${new Date(state.accountSummary.updatedAt).toLocaleString("ko-KR")}`
                            : "아직 동기화하지 않음"}
                        </span>
                      </div>
                      <div className="account-list">
                        {state?.accounts?.length
                          ? state.accounts.map((account) => (
                              <div className="account-row" key={account.id}>
                                <span>
                                  {session.bankOptions.find((bank) => bank.value === account.organization)?.label || account.organization}
                                  <small>{account.name} · {account.display}</small>
                                </span>
                                <strong>{won(account.available)}</strong>
                              </div>
                            ))
                          : session.bankConnection.organizations?.map((organization) => (
                              <div className="account-row" key={organization}>
                                <span>
                                  {session.bankOptions.find((bank) => bank.value === organization)?.label || organization}
                                  <small>계좌 내역 확인 전</small>
                                </span>
                                <small>{session.bankConnection.methods.map((method) => bankMethodLabels[method] || method).join(" + ")}</small>
                              </div>
                            ))}
                      </div>
                    </div>
                    {session.bankConnection.quickConnections?.length > 0 && (
                      <div className="linked-accounts" aria-label="연결된 빠른조회 계좌">
                        {session.bankConnection.quickConnections.map((connection) => {
                          const editType =
                            quickEditTypes[connection.id] || connection.credentialType;
                          return (
                            <form key={connection.id} onSubmit={updateQuickBank} autoComplete="off">
                              <input type="hidden" name="connectionId" value={connection.id} />
                              <label>
                                별칭
                                <input
                                  name="alias"
                                  maxLength="40"
                                  defaultValue={connection.alias}
                                  placeholder="예: 월급 통장"
                                />
                              </label>
                              <label>
                                은행
                                <select
                                  name="organization"
                                  defaultValue={connection.organization}
                                >
                                  {session.bankOptions.map((bank) => (
                                    <option key={bank.value} value={bank.value}>{bank.label}</option>
                                  ))}
                                </select>
                              </label>
                              <details className="quick-credentials">
                                <summary>인증정보 수정 · {connection.display}</summary>
                                <div className="form-grid">
                                  <label>
                                    인증 방식
                                    <select
                                      name="credentialType"
                                      value={editType}
                                      onChange={(event) =>
                                        setQuickEditTypes((current) => ({
                                          ...current,
                                          [connection.id]: event.target.value,
                                        }))
                                      }
                                    >
                                      <option value="account">계좌번호 + 계좌 비밀번호</option>
                                      <option value="fast">조회전용 정보</option>
                                      <option value="id">인터넷뱅킹 ID</option>
                                    </select>
                                  </label>
                                  <button
                                    type="button"
                                    className="quiet credential-reveal"
                                    aria-label={revealedAccounts.includes(connection.id) ? "저장된 인증정보 숨기기" : "저장된 인증정보 보기"}
                                    aria-pressed={revealedAccounts.includes(connection.id)}
                                    disabled={editType !== connection.credentialType}
                                    onClick={(event) =>
                                      toggleQuickCredentials(connection, event.currentTarget)
                                    }
                                  >
                                    <EyeIcon hidden={revealedAccounts.includes(connection.id)} />
                                  </button>
                                  {editType === "account" && (
                                    <>
                                      <label>
                                        계좌번호
                                        <span className="account-input">
                                          <input
                                            name="account"
                                            data-secret
                                            inputMode="numeric"
                                            maxLength="40"
                                            required={connection.credentialType !== "account"}
                                            type="password"
                                            placeholder="•••••••• · 저장됨"
                                          />
                                        </span>
                                      </label>
                                      <label>
                                        계좌 비밀번호
                                        <input
                                          name="accountPassword"
                                          data-secret
                                          type="password"
                                          required={connection.credentialType !== "account"}
                                          maxLength="200"
                                          placeholder="•••• · 저장됨"
                                        />
                                      </label>
                                    </>
                                  )}
                                  {editType === "fast" && (
                                    <>
                                      <label>
                                        조회전용 아이디
                                        <input name="fastId" data-secret type="password" required={connection.credentialType !== "fast"} maxLength="200" placeholder="•••••••• · 저장됨" />
                                      </label>
                                      <label>
                                        조회전용 비밀번호
                                        <input name="fastPassword" data-secret type="password" required={connection.credentialType !== "fast"} maxLength="200" placeholder="•••• · 저장됨" />
                                      </label>
                                    </>
                                  )}
                                  {editType === "id" && (
                                    <>
                                      <label>
                                        계좌번호
                                        <input
                                          name="account"
                                          data-secret
                                          inputMode="numeric"
                                          required={connection.credentialType !== "id"}
                                          maxLength="40"
                                          type="password"
                                          placeholder="•••••••• · 저장됨"
                                        />
                                      </label>
                                      <label>
                                        계좌 비밀번호
                                        <input
                                          name="accountPassword"
                                          data-secret
                                          type="password"
                                          required={connection.credentialType !== "id"}
                                          maxLength="200"
                                          placeholder="•••• · 저장됨"
                                        />
                                      </label>
                                      <label>
                                        인터넷뱅킹 ID
                                        <input name="quickId" data-secret type="password" required={connection.credentialType !== "id"} maxLength="200" placeholder="•••••••• · 저장됨" />
                                      </label>
                                      <label>
                                        인터넷뱅킹 비밀번호
                                        <input name="quickPassword" data-secret type="password" required={connection.credentialType !== "id"} maxLength="200" placeholder="•••• · 저장됨" />
                                      </label>
                                    </>
                                  )}
                                  <label>
                                    생년월일 · 은행이 요구할 때
                                    <input name="identity" data-secret type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder={connection.hasIdentity ? "•••••• · 저장됨" : "YYMMDD · 선택"} />
                                  </label>
                                </div>
                              </details>
                              <div className="account-actions">
                                <button>저장</button>
                                <button
                                  type="button"
                                  className="quiet"
                                  onClick={() => disconnectQuick(connection)}
                                >
                                  연결 끊기
                                </button>
                              </div>
                            </form>
                          );
                        })}
                      </div>
                    )}
                    <details open={!session.bankConnection.connected}>
                      <summary>
                        {session.bankConnection.connected ? "CODEF API 키 변경" : "CODEF API 키 입력"}
                      </summary>
                      <form onSubmit={connectBank} autoComplete="off">
                        <div className="form-grid">
                          <label>
                            CODEF 환경
                            <select name="environment" defaultValue={session.bankConnection.environment || "demo"}>
                              <option value="demo">데모</option>
                              <option value="production">운영</option>
                            </select>
                          </label>
                          <label>
                            Client ID
                            <input name="clientId" data-connection-secret type="password" required minLength="8" maxLength="300" placeholder={session.bankConnection.connected ? "•••••••• · 저장됨" : ""} />
                          </label>
                          <label>
                            Client Secret
                            <input name="clientSecret" data-connection-secret type="password" required minLength="8" maxLength="500" placeholder={session.bankConnection.connected ? "•••••••• · 저장됨" : ""} />
                          </label>
                          <label>
                            Public Key
                            <textarea name="publicKey" data-connection-secret required minLength="100" maxLength="2000" placeholder={session.bankConnection.connected ? "•••••••• · 저장됨" : ""} />
                          </label>
                          <label>
                            Connected ID · 이미 있을 때만
                            <input name="connectedId" data-connection-secret type="password" minLength="8" maxLength="300" placeholder={session.bankConnection.connectedId ? `${session.bankConnection.connectedId} · 저장됨` : "없음"} />
                          </label>
                          {session.bankConnection.connected && (
                            <button
                              type="button"
                              className="quiet credential-reveal"
                              aria-label={revealedBankConnection ? "저장된 CODEF 연결정보 숨기기" : "저장된 CODEF 연결정보 보기"}
                              aria-pressed={revealedBankConnection}
                              onClick={(event) => toggleBankConnection(event.currentTarget.form)}
                            >
                              <EyeIcon hidden={revealedBankConnection} />
                            </button>
                          )}
                        </div>
                        <button className="primary">연결 정보 저장</button>
                      </form>
                    </details>
                    {session.bankConnection.connected && (
                      <details open={!session.bankConnection.ready}>
                        <summary>
                          {session.bankConnection.ready ? "은행 계좌 추가" : "은행 계정 등록"}
                        </summary>
                        <form onSubmit={registerBank} autoComplete="off">
                        <div className="form-grid">
                          <label>
                            은행
                            <select name="organization" required defaultValue="0088">
                              {session.bankOptions.map((bank) => (
                                <option key={bank.value} value={bank.value}>{bank.label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            연결 방식
                            <select
                              name="method"
                              value={bankMethod}
                              onChange={(event) => setBankMethod(event.target.value)}
                            >
                              <option value="id">인터넷뱅킹 ID</option>
                              <option value="quick">빠른조회</option>
                              <option value="certificate">공동인증서</option>
                            </select>
                          </label>
                          {bankMethod === "id" && (
                            <>
                              <label>
                                인터넷뱅킹 ID
                                <input name="loginId" required maxLength="200" />
                              </label>
                              <label>
                                인터넷뱅킹 비밀번호
                                <input name="loginPassword" type="password" required maxLength="200" />
                              </label>
                            </>
                          )}
                          {bankMethod === "quick" && (
                            <>
                              <label>
                                별칭 · 선택
                                <input name="alias" maxLength="40" placeholder="예: 생활비 통장" />
                              </label>
                              <label>
                                빠른조회 정보
                                <select
                                  value={quickCredentialType}
                                  onChange={(event) =>
                                    setQuickCredentialType(event.target.value)
                                  }
                                >
                                  <option value="account">계좌번호 + 계좌 비밀번호</option>
                                  <option value="fast">조회전용 정보</option>
                                  <option value="id">인터넷뱅킹 ID</option>
                                </select>
                              </label>
                              {quickCredentialType === "account" && (
                                <>
                                  <label>
                                    계좌번호
                                    <input name="account" inputMode="numeric" required maxLength="40" />
                                  </label>
                                  <label>
                                    계좌 비밀번호
                                    <input name="accountPassword" type="password" required maxLength="200" />
                                  </label>
                                </>
                              )}
                              {quickCredentialType === "fast" && (
                                <>
                                  <label>
                                    조회전용 아이디
                                    <input name="fastId" required maxLength="200" />
                                  </label>
                                  <label>
                                    조회전용 비밀번호
                                    <input name="fastPassword" type="password" required maxLength="200" />
                                  </label>
                                </>
                              )}
                              {quickCredentialType === "id" && (
                                <>
                                  <label>
                                    계좌번호
                                    <input name="account" inputMode="numeric" required maxLength="40" />
                                  </label>
                                  <label>
                                    계좌 비밀번호
                                    <input name="accountPassword" type="password" required maxLength="200" />
                                  </label>
                                  <label>
                                    인터넷뱅킹 ID
                                    <input name="quickId" required maxLength="200" />
                                  </label>
                                  <label>
                                    인터넷뱅킹 비밀번호
                                    <input name="quickPassword" type="password" required maxLength="200" />
                                  </label>
                                </>
                              )}
                              <label>
                                생년월일 · 은행이 요구할 때
                                <input name="identity" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="YYMMDD" />
                              </label>
                            </>
                          )}
                          {bankMethod === "certificate" && (
                            <>
                              <label>
                                인증서 형식
                                <select
                                  name="certType"
                                  value={certificateType}
                                  onChange={(event) => setCertificateType(event.target.value)}
                                >
                                  <option value="1">DER + KEY</option>
                                  <option value="pfx">PFX / P12</option>
                                </select>
                              </label>
                              {certificateType === "pfx" ? (
                                <label>
                                  PFX 또는 P12 파일
                                  <input name="certFile" type="file" accept=".pfx,.p12" required />
                                </label>
                              ) : (
                                <>
                                  <label>
                                    인증서 DER 파일
                                    <input name="derFile" type="file" accept=".der,.cer" required />
                                  </label>
                                  <label>
                                    인증서 KEY 파일
                                    <input name="keyFile" type="file" accept=".key" required />
                                  </label>
                                </>
                              )}
                              <label>
                                인증서 비밀번호
                                <input name="certificatePassword" type="password" required maxLength="200" />
                              </label>
                            </>
                          )}
                          {bankMethod !== "quick" && (
                            <label>
                              생년월일 · 은행이 요구할 때
                              <input name="birthDate" inputMode="numeric" pattern="[0-9]{6}([0-9]{2})?" maxLength="8" placeholder="YYMMDD 또는 YYYYMMDD" />
                            </label>
                          )}
                        </div>
                        <button className="primary">
                          {bankMethod === "quick" ? "빠른조회 연결" : "은행 인증 후 연결"}
                        </button>
                        </form>
                      </details>
                    )}
                    {session.bankConnection.ready && (
                      <>
                        <form className="bank-sync" onSubmit={syncBank}>
                          <label>
                            시작일
                            <input name="from" type="date" required defaultValue={defaultBankFrom()} />
                          </label>
                          <label>
                            종료일
                            <input name="to" type="date" required defaultValue={inputDate()} />
                          </label>
                          <button className="primary">계좌 자료 동기화</button>
                        </form>
                        <button
                          className="quiet"
                          onClick={() => action(async () => {
                            const bankConnection = await api("/bank/connection", undefined, "DELETE");
                            setSession((current) => ({ ...current, bankConnection }));
                          })}
                        >
                          연결 정보 지우기
                        </button>
                      </>
                    )}
                    <p className="fine">
                      ID 비밀번호와 인증서 파일은 등록 후 남기지 않습니다. 다시 동기화할 때 필요한 빠른조회 정보만 이 기기에 암호화 저장합니다. 계좌번호는 기본으로 가리고 보기 버튼을 눌렀을 때만 표시합니다. 이체는 지원하지 않습니다.
                    </p>
                  </section>
                  <section>
                    <h2>AI 연결</h2>
                    <p className="flow-note">
                      거래나 소득이 바뀌면 이 연결로 자동 분류와 분석을 실행합니다.
                      API 키는 메모리에만 두고 서버를 재시작하면 지웁니다.
                    </p>
                    <form onSubmit={connect}>
                      <div className="form-grid">
                        <label>
                          사용할 연결
                          <select
                            name="provider"
                            value={connectionProvider}
                            onChange={(e) =>
                              setConnectionProvider(e.target.value)
                            }
                          >
                            <option value="codex">
                              Codex / OpenCodex · ChatGPT 구독 로그인
                            </option>
                            <option value="openai">OpenAI · API 키</option>
                            <option value="anthropic">
                              Anthropic · API 키
                            </option>
                          </select>
                        </label>
                        <label>
                          사용할 AI
                          <select
                            key={connectionProvider}
                            name="model"
                            defaultValue={
                              session.connection.provider === connectionProvider
                                ? session.connection.model
                                : session.connectionModels[connectionProvider][0]
                                    .value
                            }
                          >
                            {session.connectionModels[connectionProvider].map(
                              (model) => (
                                <option key={model.value} value={model.value}>
                                  {model.label}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          API 키
                          <input
                            name="key"
                            type="password"
                            autoComplete="off"
                            maxLength="500"
                            placeholder="구독 로그인은 입력 불필요"
                          />
                        </label>
                      </div>
                      <button className="primary">이 연결 사용</button>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() =>
                          action(async () => {
                            const c = await api(
                              "/connection",
                              undefined,
                              "DELETE",
                            );
                            setSession((s) => ({ ...s, connection: c }));
                          })
                        }
                      >
                        API 키 지우기
                      </button>
                    </form>
                    <p className="connection-status">
                      지금은 {session.connection.provider}{" "}
                      {session.connection.model || "기본 모델"}을 쓰고 있습니다.{" "}
                      {session.connection.hasKey ? "API 키 있음" : "API 키 없음"}
                    </p>
                    {connectionProvider === "codex" && (
                      <>
                    <div className="login-actions">
                      <button
                        onClick={() =>
                          action(async () =>
                            setLogin((await api("/codex/login", {})).url),
                          )
                        }
                      >
                        ChatGPT로 로그인
                      </button>
                      <button
                        onClick={() =>
                          action(async () =>
                            setCodex(await api("/codex/status", {})),
                          )
                        }
                      >
                        로그인 상태 확인
                      </button>
                      <button
                        className="quiet"
                        onClick={() =>
                          action(async () =>
                            setCodex(await api("/codex/logout", {})),
                          )
                        }
                      >
                        구독 로그아웃
                      </button>
                    </div>
                    {login && (
                      <a
                        className="login-link"
                        href={login}
                        target="_blank"
                        rel="noreferrer"
                      >
                        공식 로그인 페이지 열기 ↗
                      </a>
                    )}
                    {codex && (
                      <p role="status">
                        {codex.connected
                          ? codex.route === "opencodex"
                            ? `Codex 구독 연결됨 · OpenCodex ${codex.opencodexVersion} 경유`
                            : "Codex 구독 연결됨 · 공식 Codex 경로"
                          : "구독 로그인 필요"}
                      </p>
                    )}
                      </>
                    )}
                    <p className="flow-note">
                      Codex 로그인 정보는 이 프로젝트 안에만 저장됩니다. OpenCodex가
                      실행 중이면 자동으로 그쪽을 씁니다.
                    </p>
                  </section>
                  <section>
                    <h2>거래 불러오기</h2>
                    <p className="flow-note">
                      거래 JSON이나 CODEF 승인내역 파일을 올리면 분석에 씁니다.
                    </p>
                    <label className="file-input">
                      거래 JSON / CODEF 승인내역 가져오기
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={(e) =>
                          action(async () => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2000000)
                              throw Error("2MB 이하 파일을 선택하세요.");
                            await api("/import", JSON.parse(await file.text()));
                            e.target.value = "";
                            await refresh();
                          })
                        }
                      />
                    </label>
                    <details className="format-help">
                      <summary>지원 형식</summary>
                      <p className="fine">
                        일반 거래 파일: transactions, from, to, complete, source.
                        CODEF 응답은 전체 수집 여부를 미확인으로 저장합니다. 같은
                        source·id를 다시 가져오면 갱신합니다.
                      </p>
                    </details>
                    <h3>최근 가져오기</h3>
                    {state.coverage.map((c, i) => (
                      <p className="fine" key={i}>
                        {c.from} ~ {c.to} · {c.source} ·{" "}
                        {c.complete ? "전체 기간 확인" : "일부 자료"}
                      </p>
                    ))}
                  </section>
                  <section>
                    <h2>MCP 연결</h2>
                    <p className="flow-note">
                      설정을 복사해 MCP를 지원하는 AI 앱에 등록하면 같은 자료를 쓸 수
                      있습니다.
                    </p>
                    <button
                      onClick={() =>
                        action(async () => {
                          const config = await api("/mcp-config");
                          await navigator.clipboard.writeText(
                            JSON.stringify(config, null, 2),
                          );
                          document.querySelector("#copy-status").textContent =
                            "MCP 설정을 복사했습니다.";
                        })
                      }
                    >
                      MCP 연결 설정 복사
                    </button>
                    <p id="copy-status" role="status" className="fine" />
                    <p className="flow-note">
                      별도 키는 필요 없고, 연결한 앱의 구독과 정책을 따릅니다.
                    </p>
                  </section>
                  <section>
                    <h2>최근 반영 기록</h2>
                    {state.events.map((e, i) => (
                      <p className="event" key={i}>
                        <time>{new Date(e.at).toLocaleString("ko-KR")}</time>
                        {e.action}
                      </p>
                    ))}
                  </section>
                </div>
              )}
            </>
          )}
        </main>
        <footer>여유는 이 기기에서만 동작하는 개인용 도구입니다. 결제나 이체는 하지 않습니다.</footer>
      </div>
      <dialog id="transaction-detail" onClose={() => setDetail(null)}>
        {detail && (
          <>
            <form method="dialog">
              <button className="close">닫기</button>
            </form>
            <p className="eyebrow">거래 판정 근거</p>
            <h2>{detail.merchant}</h2>
            <p className="lead-amount">{won(detail.amount)}</p>
            <p>
              {detail.date} · {labels[detail.status]}
            </p>
            <p className="evidence">
              {detail.evidence || "추가 판정 근거 없음"}
            </p>
            <p className="fine">출처: {detail.source}</p>
            {detail.aiCategory && (
              <p className="fine">AI 분류 근거: {detail.aiCategory.reason}</p>
            )}
            <button
              onClick={() =>
                action(() =>
                  tool("confirm_recurring", {
                    merchant: detail.merchant,
                    confirmed: true,
                  }),
                )
              }
            >
              이 이용처를 고정비로 지정
            </button>
          </>
        )}
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
