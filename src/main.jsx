import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./style.css";
import { t as tr, f, setLang, getLang, onLangChange, money as fmtMoney, dateTime, months as fmtMonths, dayOfMonth } from "./i18n.js";

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
  if (!r.ok) throw Error(friendly(data.error));
  return data;
}
const won = (n) => fmtMoney(n);
// Server messages are already written for people; anything else (network, browser, library text)
// gets a plain sentence instead of its system wording.
const FRIENDLY = [
  [/Failed to fetch|NetworkError|network error|ERR_CONNECTION/i, "서버에 연결하지 못했습니다. 앱이 실행 중인지 확인해 주세요."],
  [/clipboard|writeText/i, "복사가 막혀 있어요. 내용을 직접 선택해 복사해 주세요."],
  [/AbortError|timeout|timed out/i, "시간이 너무 오래 걸려 멈췄습니다. 잠시 후 다시 시도해 주세요."],
  [/JSON|Unexpected token|SyntaxError/i, "받은 자료를 읽지 못했습니다. 잠시 후 다시 시도해 주세요."],
  [/quota|rate limit|usage limit/i, "AI 사용 한도에 도달했습니다. 한도가 복구된 뒤 다시 시도해 주세요."],
];
const friendly = (message) => {
  const text = String(message || "").trim();
  if (!text) return tr("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  for (const [pattern, replacement] of FRIENDLY)
    if (pattern.test(text)) return tr(replacement);
  // A sentence with Korean in it came from this app and is meant to be read.
  if (/[가-힣]/.test(text)) return tr(text);
  return tr("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
};
const STAGES = {
  prepare: { label: "자료 정리", percent: 12 },
  think: { label: "AI가 읽는 중", percent: 45 },
  reason: { label: "따져보는 중", percent: 70 },
  write: { label: "답 정리 중", percent: 85 },
  save: { label: "결과 저장", percent: 95 },
};
// Looked up through t() at render time so switching language re-labels them.
const labels = {
  paid: "납부 확인",
  unpaid: "미납",
  cancelled: "취소",
  partial: "부분취소 확인 필요",
  rejected: "승인 거절",
};
// Server-computed verdict → one plain sentence. Assumption: 3 months interest-free, longer with fees.
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
      return reject(Error(tr("인증서 파일은 각각 500KB 이하여야 합니다.")));
    const reader = new FileReader();
    reader.onerror = () => reject(Error(tr("인증서 파일을 읽지 못했습니다.")));
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.readAsDataURL(file);
  });
// Resolved through tr() where they are used, so a language switch re-labels them.
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
function Mark({ size = 40 }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="27" cy="29" r="17" fill="none" stroke="currentColor" strokeWidth="13" />
      <path d="M44 29V50a6.5 6.5 0 0 0 13 0V29z" fill="currentColor" />
      <circle cx="50" cy="50" r="9" fill="var(--accent)" stroke="var(--paper)" strokeWidth="3" />
    </svg>
  );
}
function Amount({
  label,
  name,
  value,
  optional = false,
  min = "0",
  placeholder = tr("자동 제안"),
}) {
  return (
    <label>
      {label}
      <span className="input-unit">
        <input
          name={name}
          type="number"
          min={min}
          max="1000000000"
          step="1"
          required={!optional}
          defaultValue={value ?? ""}
          placeholder={optional ? placeholder : ""}
        />
        <span>{tr("원")}</span>
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
        <label>{tr("제품명")}<input
            name="name"
            required
            maxLength="120"
            defaultValue={goal?.name || ""}
            placeholder={tr("예: 작업용 모니터")}
          />
        </label>
        <Amount label={tr("제품 금액")} name="price" value={goal?.price} min="1" />
        <Amount label={tr("이 목표에 모은 금액")} name="saved" value={goal?.saved ?? 0} />
        <label>{tr("제품 링크 · 선택")}<input
            name="productUrl"
            type="url"
            maxLength="2048"
            defaultValue={goal?.productUrl || ""}
            placeholder="https://"
          />
        </label>
        <label>{tr("제품 이미지 주소 · 선택")}<input
            name="imageUrl"
            type="url"
            maxLength="2048"
            defaultValue={goal?.imageUrl || ""}
            placeholder="https://"
          />
        </label>
        <label>{tr("메모 · 선택")}<input
            name="note"
            maxLength="300"
            defaultValue={goal?.note || ""}
            placeholder={tr("예: 업무 환경 개선")}
          />
        </label>
      </div>
      <button className="primary">{goal ? tr("목표 수정") : tr("목표 추가")}</button>
    </form>
  );
}

function PurchaseGoals({ goals, plan, onSave, onRemove, onDiscuss }) {
  return (
    <section className="goals" aria-labelledby="goals-title">
      <div className="section-header">
        <h2 id="goals-title">{tr("구매 목표")}</h2>
        <span className="fine">{tr("별도 적립액 기준")}</span>
      </div>
      {goals.length ? (
        <div className="goal-list">
          {goals.map((goal) => (
            <article className="goal" key={goal.id}>
              {goal.imageUrl && (
                <img
                  src={goal.imageUrl}
                  alt={f("{0} 제품 이미지", goal.name)}
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
                  aria-label={f("{0} 구매 목표 진행률 {1}%", goal.name, goal.progress.percent)}
                />
                <p className="goal-progress">
                  {f("{0}% · {1} 모음 · {2} 남음", goal.progress.percent, won(goal.saved), won(goal.progress.remaining))}
                </p>
                <p className="fine">
                  {goal.progress.remaining === 0
                    ? tr("구매 금액을 모두 모았습니다.")
                    : !plan.ready
                      ? tr("월 소득을 입력하면 예상 기간을 계산합니다.")
                      : goal.progress.cashMonths
                        ? f("현재 배분 후 남는 돈을 모두 모으면 약 {0}개월입니다.", goal.progress.cashMonths)
                        : tr("현재 배분에서는 목표에 추가할 여유 금액이 없습니다.")}
                </p>
                {goal.progress.advice && (
                  <p className={"verdict " + goal.progress.advice.verdict}>
                    {goal.progress.advice.text}
                  </p>
                )}
                {goal.note && <p>{goal.note}</p>}
                {goal.productUrl && (
                  <a
                    href={goal.productUrl}
                    target="_blank"
                    rel="noreferrer nofollow"
                  >{tr("제품 페이지 열기 ↗")}</a>
                )}
                <div className="goal-actions">
                  <button className="quiet" onClick={() => onDiscuss(goal)}>{tr("대화로 계획 세우기")}</button>
                  <details>
                    <summary>{tr("목표 수정")}</summary>
                    <GoalForm goal={goal} onSave={onSave} />
                  </details>
                  <button className="quiet" onClick={() => onRemove(goal.id, goal.name)}>{tr("삭제")}</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="flow-note">{tr("아직 목표가 없습니다. 아래에서 직접 추가하거나 대화로 제품을 찾아 추가할 수 있습니다.")}</p>
      )}
      <details className="goal-add">
        <summary>{tr("새 구매 목표 직접 추가")}</summary>
        <GoalForm onSave={onSave} />
      </details>
    </section>
  );
}

const settingsOnly = (p) => p.changes.every((c) => ["autosync", "notifications", "autoinvest"].includes(c.type));
function Proposal({ proposal: p, cats }) {
  const fields = {
    income: tr("월 소득"),
    annualGross: tr("연간 세전 계약연봉"),
    balance: tr("현재 통장 잔액"),
    payday: tr("월급일"),
    savings: tr("저축"),
    reserve: tr("비상자금"),
    debt: tr("기존 상환액"),
    savingsLocked: tr("저축"),
    reserveLocked: tr("비상자금"),
    cardDueDay: tr("카드 결제일"),
    interestFreeMonths: tr("카드 무이자 개월"),
    installmentRate: tr("할부 수수료(연 %)"),
  };
  return (
    <>
      <p>
        <strong>{f("반영할 조건 · {0}", p.month)}</strong>
      </p>
      {p.changes.map((c, i) => (
        <p key={i}>
          {c.type === "preference"
            ? f("{0} {1} {2} · {3}", cats[c.category], won(c.amount), c.operation === "set" ? tr("설정") : c.operation === "increase" ? tr("증액") : tr("감액"), c.month === "always" ? tr("매달") : c.month + tr("만"))
            : c.type === "remove_preference"
              ? f("{0} {1} 선호 해제", cats[c.category], c.month === "always" ? tr("매달") : c.month)
              : c.type === "profile"
                ? `${fields[c.field]} ${["payday", "cardDueDay"].includes(c.field) ? f("매월 {0}일", c.amount) : c.field === "interestFreeMonths" ? fmtMonths(c.amount) : c.field === "installmentRate" ? `${c.amount}%` : won(c.amount)} ${c.operation === "set" ? tr("설정") : c.operation === "increase" ? tr("증액") : tr("감액")}`
                : c.type === "protect"
                  ? f("{0} {1}", fields[c.field], c.enabled ? tr("금액 유지") : tr("유지 해제"))
                  : c.type === "category"
                    ? `${c.merchant} → ${cats[c.category]}`
                    : c.type === "goal"
                      ? f("{0} 구매 목표 · {1} · 모은 금액 {2}", c.name, won(c.price), won(c.saved))
                      : c.type === "installment"
                        ? f("{0} {1}", c.merchant, c.months === 1 ? tr("할부 해제") : fmtMonths(c.months) + tr(" 할부"))
                        : c.type === "remove_goal"
                          ? tr("구매 목표 삭제")
                          : c.type === "autosync"
                            ? tr("자동 수집 ") + Object.entries(c).filter(([k]) => k !== "type").map(([k, v]) => ({ enabled: v ? tr("켬") : tr("끔"), intervalHours: f("{0}시간마다", v), fromHour: f("{0}시부터", v), toHour: f("{0}시까지", v) })[k]).join(" · ")
                            : c.type === "autoinvest"
                              ? tr("자동 투자 ") + Object.entries(c).filter(([k]) => k !== "type").map(([k, v]) => ({ enabled: v ? tr("켬") : tr("끔"), live: v ? tr("실제 주문") : tr("모의 실행"), principal: f("원금 {0}", won(v)), lossLimitPct: f("손실 한도 {0}%", v), intervalMinutes: f("{0}분마다", v), maxOrdersPerDay: f("하루 {0}회까지", v) })[k]).join(" · ")
                            : c.type === "notifications"
                              ? tr("알림 ") + Object.entries(c).filter(([k]) => k !== "type").map(([k, v]) => ({ desktop: f("PC 알림 {0}", v ? tr("켬") : tr("끔")), ntfyTopic: v ? f("ntfy 주제 {0}", v) : "ntfy 해제", ntfyServer: v ? f("ntfy 서버 {0}", v) : "ntfy 서버 기본" })[k]).join(" · ")
                        : f("{0} 고정비 {1}", c.merchant, c.confirmed ? tr("지정") : tr("해제"))}
        </p>
      ))}
      {p.after.ready && !settingsOnly(p) && (
        <>
          <p>
            {tr("저축")} {p.before.ready ? won(p.before.savings) : tr("미설정")} →{" "}
            <strong>{won(p.after.savings)}</strong>
          </p>
          <p>
            {tr("남는 돈")} {p.before.ready ? won(p.before.free) : tr("미설정")} →{" "}
            <strong>{won(p.after.free)}</strong>
          </p>
          {p.after.shortage > 0 && (
            <p className="notice">
              {f("유지할 금액이 소득보다 {0} 많습니다.", won(p.after.shortage))}
            </p>
          )}
        </>
      )}
    </>
  );
}
// Stays put while the user moves between tabs: the analysis keeps running in the background.
function AiProgress({ status, seenAt, onOpen }) {
  const running = !!status?.reviewBusy;
  const startedAt = status?.progress?.startedAt;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) return setElapsed(0);
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);
  const done = !running && status?.lastReviewAt && status.lastReviewAt !== seenAt;
  if (!running && !done) return null;
  const stage = STAGES[status?.progress?.stage] || STAGES.prepare;
  return (
    <section className={"ai-progress" + (running ? " running" : " done")} aria-live="polite">
      <p className="ai-progress-title">
        {running ? (
          <>
            <span className="spinner" aria-hidden="true" />
            {tr(stage.label)}
          </>
        ) : (
          tr("분석 완료")
        )}
      </p>
      <div className="ai-bar" role="presentation">
        <span style={{ width: (running ? stage.percent : 100) + "%" }} />
      </div>
      <p className="fine">
        {running
          ? status?.progress?.detail || tr("거래와 계좌 자료를 모으고 있어요")
          : tr("지출 살펴보기에서 결과를 확인하세요.")}
      </p>
      {running && elapsed > 4 && (
        <p className="fine">
          {elapsed < 60 ? f("{0}초째 진행 중", elapsed) : f("{0}분 {1}초째 진행 중", Math.floor(elapsed / 60), elapsed % 60)}
        </p>
      )}
      {!running && (
        <button className="quiet" onClick={onOpen}>{tr("결과 보기")}</button>
      )}
    </section>
  );
}
function AdviceBasis({ b }) {
  return (
    <div className="basis">
      <p>
        <strong>{f("이번 달 여유 {0}", won(b.free))}</strong>
        <br />{f("= 실수령 {0} − 저축 {1} − 비상자금 {2} − 고정비 {3} − 기존 상환 {4}", won(b.income), won(b.savings), won(b.reserve), won(b.fixedTotal), won(b.debt))}
        {b.installments > 0 ? f(" − 할부 상환 {0}", won(b.installments)) : ""}
        {f(" − 생활비 예산 {0}", won(b.allocations))}
      </p>
      <p>
        <strong>{f("지금 쓸 수 있는 잔액 {0}", won(b.cashNow))}</strong>
        <br />{f("= 잔액 {0} −", won(b.balance))}{" "}
        {b.nextPayday ? f("다음 월급({0})까지 지킬 돈", b.nextPayday) : tr("월급일 미입력이라 한 달치 지킬 돈")}{" "}
        {won(b.protectedCash)}
      </p>
      <p className="fine">
        {f("가정: {0}개월까지 무이자, 그 이상 연 {1}% · 카드 결제일 {2}. 현금 흐름과 목표 수정에서 바꿀 수 있습니다. 여유가 작게 나오면 저축·비상자금 목표가 커서인 경우가 대부분입니다.", b.interestFreeMonths, b.ratePercent, b.cardDueDay ? dayOfMonth(b.cardDueDay) : tr("미입력(월급 뒤로 가정)"))}
      </p>
    </div>
  );
}
function AnalysisPanel({ review, onRetry, onDiscuss, onInstallment }) {
  const usable = review?.status === "complete" && !review.stale;
  return (
    <section className="ai-analysis" aria-label={tr("먼저 살펴볼 지출")}>
      <div className="section-header">
        <h2>{tr("먼저 살펴볼 지출")}</h2>
        <button
          className="quiet"
          disabled={review?.status === "running"}
          onClick={onRetry}
        >{tr("다시 분석")}</button>
      </div>
      {review?.status === "running" ? (
        <p role="status">{tr("거래를 분류하고 소득 대비 부담이 큰 지출을 살펴보고 있습니다.")}</p>
      ) : review?.status === "error" ? (
        <>
          <p className="notice" role="status">
            {tr(review.error)}
          </p>
          {review.pendingCount > 0 && (
            <p className="fine">
              {f("분류하지 못한 거래가 {0}건 남아 있습니다. 다시 분석을 누르면 이어서 처리합니다.", review.pendingCount)}
            </p>
          )}
        </>
      ) : !usable ? (
        <p className="fine">{tr("거래나 소득이 바뀌면 자동으로 분석합니다. AI 연결이 없으면 설정에서 먼저 연결해 주세요.")}</p>
      ) : (
        <>
          <p className="analysis-summary">{review.summary}</p>
          <p className="fine">
            {tr(review.scopeNote)} · {review.provider} ·{" "}
            {dateTime(review.at)}
            {review.pendingCount > 0
              ? tr(" · 남은 ") + review.pendingCount + tr("건 분류 중")
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
          <h3>{tr("미리 납부해도 될 거래")}</h3>
          <p className="fine">{review.prepaymentNote}</p>
          {(review.prepayments || []).map((t) => (
            <article className="large-expense" key={t.key}>
              <div className="expense-title">
                <strong>{t.merchant}</strong>
                <strong>{won(t.amount)}</strong>
              </div>
              <p className="fine">{t.date} · {tr("미납")}</p>
              <p>{t.reason}</p>
            </article>
          ))}
          <h3>{tr("소득과 비교해 먼저 살펴볼 거래")}</h3>
          {review.largeExpenses.length ? (
            review.largeExpenses.map((t) => (
              <article className="large-expense" key={t.key}>
                <div className="expense-title">
                  <strong>{t.merchant}</strong>
                  <strong>{won(t.amount)}</strong>
                </div>
                <p className="fine">
                  {t.date} · {f("월 실수령의 {0}%", t.incomePercent)} · {tr(labels[t.status])}
                  {t.installment ? f(" · {0} 할부 반영됨", fmtMonths(t.installment.months)) : ""}
                </p>
                {t.advice ? (
                  <>
                    <p className={"verdict " + t.advice.verdict}>
                      {t.advice.text}
                    </p>
                    <p className="fine">{t.reason}</p>
                    {t.installment ? (
                      <button className="quiet" onClick={() => onInstallment(t, 1)}>{tr("할부 해제")}</button>
                    ) : t.advice.verdict === "installment" ? (
                      <button onClick={() => onInstallment(t, t.advice.months)}>
                        {f("{0}개월 할부로 계획에 반영", t.advice.months)}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="fine">
                    {t.nextStep === "fixed"
                      ? tr("고정비로 반영된 결제라 예산에 이미 들어 있습니다.")
                      : t.nextStep === "spending_review"
                      ? tr("이미 납부된 거래입니다. 추가 결제 없이 지출 패턴을 점검합니다.")
                      : t.nextStep === "check_payment"
                        ? tr("납부·잔여 원금부터 확인해야 합니다.")
                        : tr("소득을 입력하면 할부 여부를 판단합니다.")}
                  </p>
                )}
                <button className="quiet" onClick={() => onDiscuss(t)}>{tr("이 거래를 대화로 살펴보기")}</button>
              </article>
            ))
          ) : (
            <p className="fine">{tr("현재 분석에서 별도로 제시할 거래가 없습니다. 소득 미입력 시 소득 대비 판단은 보류합니다.")}</p>
          )}
          {review.adviceBasis?.free != null && (
            <details className="why">
              <summary>{tr("왜 이렇게 판단했나")}</summary>
              <AdviceBasis b={review.adviceBasis} />
            </details>
          )}
        </>
      )}
    </section>
  );
}
// First-run checklist: shown on the plan tab until the three things the app needs are in place.
function GettingStarted({ session, state, navigate }) {
  const [codex, setCodex] = useState(null);
  useEffect(() => {
    if (session.connection.provider === "codex")
      api("/codex/status", {}).then(setCodex).catch(() => setCodex({ connected: false }));
  }, [session.connection.provider]);
  const aiDone =
    session.connection.provider === "codex" ? codex?.connected : session.connection.hasKey;
  const dataDone = state.transactions.length > 0 || state.accountSummary.connected;
  const incomeDone = !!state.plan.ready;
  if (aiDone && dataDone && incomeDone) return null;
  const steps = [
    [tr("AI 연결"), tr("분류와 판단을 맡길 AI를 고릅니다. ChatGPT 구독이 있으면 로그인만 하면 됩니다."), aiDone, () => navigate("settings")],
    [tr("카드·계좌 연결"), tr("CODEF로 카드 승인내역과 계좌 입출금을 가져오거나, JSON 파일을 올립니다."), dataDone, () => navigate("settings")],
    [tr("월 소득 입력"), tr("실수령액 또는 계약연봉을 적으면 남는 돈과 판단이 계산됩니다."), incomeDone, () => {
      const d = document.querySelector("details.profile");
      if (d) {
        d.open = true;
        d.scrollIntoView({ block: "start" });
        d.querySelector("input")?.focus({ preventScroll: true });
      }
    }],
  ];
  return (
    <section className="getting-started" aria-label={tr("시작하기")}>
      <p className="section-label">{tr("시작하기")}</p>
      <h2>{tr("세 가지만 연결하면 나머진 알아서 합니다.")}</h2>
      <ol>
        {steps.map(([title, detail, done, go]) => (
          <li key={title} className={done ? "done" : ""}>
            <span className="step-mark" aria-hidden="true">{done ? "✓" : ""}</span>
            <div>
              <strong>{title}</strong>
              <p className="fine">{detail}</p>
            </div>
            {done ? <span className="fine">{tr("완료")}</span> : <button className="quiet" onClick={go}>{tr("하러 가기")}</button>}
          </li>
        ))}
      </ol>
    </section>
  );
}
const STYLE_NAMES = {
  horizon: ["투자 기간", { long: "장기 위주", mid: "중기", short: "단기 위주" }],
  region: ["선호 시장", { kr: "국내 선호", us: "해외 선호", mixed: "국내·해외 혼합" }],
  risk: ["위험 성향", { aggressive: "공격적", balanced: "균형", conservative: "안정 추구" }],
  concentration: ["집중도", { concentrated: "한 종목 집중", focused: "소수 종목 위주", diversified: "분산" }],
};
const INTERVIEW = [
  ["horizon", "이 돈을 얼마나 두고 볼 건가요?", [["under1y", "1년 안"], ["1to3y", "1~3년"], ["over3y", "3년 이상"]]],
  ["lossTolerance", "얼마까지 떨어져도 버틸 수 있나요?", [["5", "-5%만 돼도 불안"], ["10", "-10%까지"], ["20", "-20%까지"], ["30", "-30% 이상도 버팀"]]],
  ["market", "어느 시장이 편한가요?", [["kr", "국내"], ["us", "해외"], ["both", "둘 다"]]],
  ["goal", "무엇을 가장 원하나요?", [["preserve", "원금 지키기"], ["income", "배당·꾸준한 수입"], ["growth", "꾸준한 성장"], ["aggressive", "높은 수익"]]],
  ["experience", "투자해 본 기간은요?", [["new", "처음"], ["some", "1~3년"], ["long", "3년 이상"]]],
];
// Investing on Toss Securities: style from real data, suggestions with evidence, and a funded autopilot.
function InvestPanel({ session, action, navigate }) {
  const [v, setV] = useState(null);
  useEffect(() => {
    if (session.tossConnection?.ready) api("/invest").then(setV).catch(() => {});
  }, [session.tossConnection?.ready]);
  if (!session.tossConnection?.ready)
    return (
      <section>
        <h2>{tr("투자")}</h2>
        <p className="flow-note">{tr("토스증권을 연결하면 보유 종목으로 투자 성향을 분석하고, 근거를 붙인 매매 제안과 자동 투자를 쓸 수 있습니다.")}</p>
        <button className="primary" onClick={() => navigate("settings")}>{tr("토스증권 연결하러 가기")}</button>
      </section>
    );
  if (!v) return <p role="status">{tr("투자 정보를 읽고 있습니다.")}</p>;
  const run = (path, body, messages) => action(async () => setV(await api(path, body)), messages);
  const { settings: st, pool, profile, interview, suggestions, valuation } = v;
  const sideWord = (side) => (side === "BUY" ? tr("매수") : tr("매도"));
  return (
    <div className="invest">
      <p className="notice">{tr("투자 자문이 아닙니다. 알아서가 계산한 숫자와 AI의 해석이며 손실이 날 수 있습니다. 근거를 확인하고 직접 판단하세요.")}</p>
      <section>
        <div className="section-header">
          <h2>{tr("투자 성향")}</h2>
          <span className="fine">{profile ? dateTime(profile.at) : ""}</span>
        </div>
        {profile?.labels?.length ? (
          <div className="account-list">
            {profile.labels.map((l) => (
              <div className="account-row" key={l.key}>
                <span>
                  {tr(STYLE_NAMES[l.key][0])} <small>{l.evidence}</small>
                </span>
                <strong>{tr(STYLE_NAMES[l.key][1][l.value])}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="flow-note">{tr("아직 분석하지 않았습니다. 보유 종목·체결 내역·60일 시세로 계산합니다.")}</p>
        )}
        {!!profile?.mismatches?.length && (
          <p className="verdict over_budget">
            {tr("인터뷰 답과 실제 계좌가 다릅니다: ")}
            {profile.mismatches
              .map((m) => f("{0} 답 {1} / 계좌 {2}", tr(STYLE_NAMES[m.key][0]), tr(STYLE_NAMES[m.key][1][m.said]), tr(STYLE_NAMES[m.key][1][m.seen])))
              .join(" · ")}
          </p>
        )}
        <button onClick={() => run("/invest/profile", {}, { pending: tr("보유 종목과 시세를 읽고 있습니다."), success: tr("투자 성향을 계산했습니다.") })}>
          {profile ? tr("성향 다시 분석") : tr("성향 분석")}
        </button>
      </section>
      <details className="why" open={!interview}>
        <summary>{interview ? tr("인터뷰 답 고치기") : tr("짧은 인터뷰 · 5문항")}</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("/invest/interview", Object.fromEntries(new FormData(e.currentTarget)), { success: tr("인터뷰를 반영했습니다.") });
          }}
        >
          <div className="form-grid">
            {INTERVIEW.map(([name, q, opts]) => (
              <label key={name}>
                {tr(q)}
                <select name={name} defaultValue={interview?.[name] || opts[1][0]} required>
                  {opts.map(([value, label]) => (
                    <option key={value} value={value}>{tr(label)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button className="primary">{tr("답 저장")}</button>
        </form>
      </details>
      <section>
        <div className="section-header">
          <h2>{tr("매매 제안")}</h2>
          <span className="fine">{suggestions ? dateTime(suggestions.at) : ""}</span>
        </div>
        <p className="flow-note">{tr("AI가 성향과 보유 현황을 보고 제안하면, 알아서가 실제 시세·잔고·예수금으로 다시 확인합니다. 주문은 버튼을 눌러야만 나갑니다.")}</p>
        {suggestions?.summary && <p>{suggestions.summary}</p>}
        {suggestions?.list?.map((d) => (
          <article className="suggestion" key={d.id}>
            <div className="expense-title">
              <strong>{f("{0} {1}주 {2}", d.name || d.symbol, d.quantity, sideWord(d.side))}</strong>
              <strong>{d.krw ? won(d.krw) : ""}</strong>
            </div>
            <p>{d.reason}</p>
            <ul className="evidence">
              {d.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            {d.status === "open" ? (
              <button
                className="primary"
                onClick={() =>
                  window.confirm(f("실제 주문입니다. {0} {1}주를 시장가로 {2}할까요?", d.name || d.symbol, d.quantity, sideWord(d.side))) &&
                  run(`/invest/suggestions/${d.id}/order`, {}, { pending: tr("주문을 보내는 중입니다."), success: tr("주문을 접수했습니다.") })
                }
              >{tr("주문 보내기")}</button>
            ) : (
              <p className="fine">{d.status === "sent" ? tr("주문 접수됨") : f("보류: {0}", tr(d.why))}</p>
            )}
          </article>
        ))}
        <button onClick={() => run("/invest/suggestions", {}, { pending: tr("AI가 제안을 만들고 확인하는 중입니다."), success: tr("제안을 받았습니다.") })}>
          {suggestions ? tr("제안 다시 받기") : tr("제안 받기")}
        </button>
      </section>
      <section>
        <h2>{tr("자동 투자")}</h2>
        <p className="flow-note">{tr("맡긴 원금 안에서만 AI가 종목과 횟수를 정해 사고팝니다. 내가 원래 가진 주식은 건드리지 않고, 손실 한도에 닿으면 스스로 멈춥니다. 대화에서 \"자동 투자 멈춰\"라고 해도 됩니다.")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const x = Object.fromEntries(new FormData(e.currentTarget));
            const live = x.mode === "live";
            if (live && !st.live && !window.confirm(tr("실제 돈으로 주문합니다. 모의 실행 기록은 초기화되고 새 원금으로 시작합니다. 켤까요?"))) return;
            run(
              "/invest/autopilot",
              {
                enabled: x.enabled === "on",
                live,
                principal: Number(x.principal),
                lossLimitPct: Number(x.lossLimitPct),
                intervalMinutes: Number(x.intervalMinutes),
                maxOrdersPerDay: Number(x.maxOrdersPerDay),
              },
              { success: tr("자동 투자 설정을 저장했습니다.") },
            );
          }}
        >
          <label className="check">
            <input type="checkbox" name="enabled" defaultChecked={st.enabled} />{tr("자동 투자 켜기")}</label>
          <div className="form-grid">
            <label>{tr("맡길 원금")}<span className="input-unit">
                <input name="principal" type="number" min="0" step="10000" required defaultValue={st.principal || ""} placeholder="1000000" />
                <span>{tr("원")}</span>
              </span>
            </label>
            <label>{tr("손실 한도")}<span className="input-unit">
                <input name="lossLimitPct" type="number" min="1" max="90" required defaultValue={st.lossLimitPct} />
                <span>%</span>
              </span>
            </label>
            <label>{tr("판단 간격")}<span className="input-unit">
                <input name="intervalMinutes" type="number" min="15" max="1440" step="5" required defaultValue={st.intervalMinutes} />
                <span>{tr("분")}</span>
              </span>
            </label>
            <label>{tr("하루 최대 주문")}<span className="input-unit">
                <input name="maxOrdersPerDay" type="number" min="1" max="50" required defaultValue={st.maxOrdersPerDay} />
                <span>{tr("회")}</span>
              </span>
            </label>
            <label>{tr("주문 방식")}<select name="mode" defaultValue={st.live ? "live" : "practice"}>
                <option value="practice">{tr("모의 실행 · 주문 안 보냄")}</option>
                <option value="live">{tr("실제 주문")}</option>
              </select>
            </label>
          </div>
          <div className="login-actions">
            <button className="primary">{tr("저장")}</button>
            <button type="button" disabled={!st.enabled} onClick={() => run("/invest/autopilot/run", {}, { pending: tr("AI가 판단하고 있습니다."), success: tr("이번 회차를 마쳤습니다.") })}>{tr("지금 한 번 판단")}</button>
            {st.enabled && (
              <button type="button" className="quiet" onClick={() => run("/invest/autopilot/stop", {}, { success: tr("자동 투자를 멈췄습니다.") })}>{tr("멈추기")}</button>
            )}
          </div>
        </form>
        {!!st.principal && (
          <div className="bank-total">
            <span>{st.live ? tr("운용 평가액") : tr("모의 평가액")}</span>
            <strong>{valuation ? won(valuation.value) : "—"}</strong>
            <small>{f("원금 {0} · 현금 {1} · 체결 대기 {2}건", won(st.principal), won(Math.round(pool.cash)), pool.pending.length)}</small>
          </div>
        )}
        {!!valuation?.positions?.length && (
          <div className="account-list">
            {valuation.positions.map((x) => (
              <div className="account-row" key={x.symbol}>
                <span>
                  {x.name || x.symbol} <small>{f("{0}주", x.qty)}</small>
                </span>
                <strong>{won(x.value)}</strong>
              </div>
            ))}
          </div>
        )}
        {!!pool.log?.length && (
          <details className="why">
            <summary>{f("판단 기록 {0}건", pool.log.length)}</summary>
            <div className="invest-log">
              {pool.log
                .slice(-30)
                .reverse()
                .map((l, i) => (
                  <div key={i} className={"log-" + l.type}>
                    <small>{dateTime(l.at)}</small>
                    <p>{tr(l.text)}</p>
                    {l.reason && <p className="fine">{l.reason}</p>}
                    {!!l.evidence?.length && (
                      <ul className="evidence">
                        {l.evidence.map((e, j) => (
                          <li key={j}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
function AutoSyncSettings({ action, session }) {
  const [s, setS] = useState(null),
    [status, setStatus] = useState("");
  useEffect(() => {
    api("/autosync").then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  const connected = session.bankConnection?.ready || session.cardConnection?.ready || session.tossConnection?.ready;
  const hh = (n) => String(n).padStart(2, "0") + ":00";
  return (
    <section>
      <h2>{tr("자동 수집")}</h2>
      <p className="flow-note">
        {tr("연결된 계좌·카드 자료를 정해진 시간대에 알아서 가져오고 분석까지 돌립니다. 대화에서 \"자동 수집 3시간마다\"처럼 말해도 바뀝니다.")}
      </p>
      {!connected && <p className="fine">{tr("계좌나 카드를 연결하면 동작합니다.")}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          action(async () => {
            setS(
              await api("/autosync", {
                enabled: f.enabled === "on",
                intervalHours: Number(f.intervalHours),
                fromHour: Number(f.fromHour),
                toHour: Number(f.toHour),
              }),
            );
            setStatus(tr("자동 수집 설정을 저장했습니다."));
          });
        }}
      >
        <label className="check">
          <input type="checkbox" name="enabled" defaultChecked={s.enabled} />{tr("자동 수집 켜기")}</label>
        <div className="form-grid three">
          <label>{tr("간격")}<span className="input-unit">
              <input name="intervalHours" type="number" min="1" max="24" step="1" defaultValue={s.intervalHours} />
              <span>{tr("시간마다")}</span>
            </span>
          </label>
          <label>{tr("시작 시각")}<span className="input-unit">
              <input name="fromHour" type="number" min="0" max="23" step="1" defaultValue={s.fromHour} />
              <span>{tr("시")}</span>
            </span>
          </label>
          <label>{tr("종료 시각")}<span className="input-unit">
              <input name="toHour" type="number" min="0" max="23" step="1" defaultValue={s.toHour} />
              <span>{tr("시")}</span>
            </span>
          </label>
        </div>
        <p className="fine">
          {f("{0}~{1} 사이에 {2}시간마다. 종료가 시작보다 이르면 자정을 넘겨 적용합니다. 시간대 밖이면 다음 시작 시각까지 기다립니다.", hh(s.fromHour), hh(s.toHour), s.intervalHours)}
        </p>
        <div className="login-actions">
          <button className="primary">{tr("저장")}</button>
          <button
            type="button"
            disabled={!connected}
            onClick={() =>
              action(
                async () => {
                  setS(await api("/autosync/run", {}));
                  setStatus(tr("지금 가져왔습니다."));
                },
                { pending: tr("계좌·카드 자료를 가져오고 있습니다."), success: tr("자료를 가져왔습니다.") },
              )
            }
          >{tr("지금 가져오기")}</button>
        </div>
      </form>
      <p role="status" className="fine">{status}</p>
      {s.last && (
        <p className="fine">
          {f("마지막 수집 {0} ·", dateTime(s.last.at))}{" "}
          {s.last.synced.length ? s.last.synced.map((k) => tr({ bank: "계좌", card: "카드", toss: "토스증권" }[k])).join("·") + tr(" 완료") : tr("가져온 것 없음")}
          {s.last.errors?.length ? tr(" · 실패: ") + s.last.errors.map((e) => e.replace(/^(.+?): (.*)$/, (_, k, m) => tr(k) + ": " + tr(m))).join(", ") : ""}
        </p>
      )}
    </section>
  );
}
function NotificationSettings({ action }) {
  const [settings, setSettings] = useState(null),
    [status, setStatus] = useState("");
  useEffect(() => {
    api("/notifications").then(setSettings).catch(() => {});
  }, []);
  if (!settings) return null;
  return (
    <section>
      <h2>{tr("알림")}</h2>
      <p className="flow-note">{tr("새로 살펴볼 결제가 생기거나 자동 분석이 실패하면 알려드립니다. 이 PC 알림센터는 기본으로 켜져 있고, 폰으로 받으려면 ntfy 앱을 설치하고 주제 이름을 정해 적으세요.")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          action(async () => {
            setSettings(
              await api("/notifications", {
                desktop: f.desktop === "on",
                ntfyTopic: f.ntfyTopic,
                ntfyServer: f.ntfyServer,
              }),
            );
            setStatus(tr("알림 설정을 저장했습니다."));
          });
        }}
      >
        <label className="check">
          <input type="checkbox" name="desktop" defaultChecked={settings.desktop} />{tr("이 PC 알림센터로 받기")}</label>
        <div className="form-grid">
          <label>{tr("ntfy 주제 이름 · 폰 푸시")}<input
              name="ntfyTopic"
              defaultValue={settings.ntfyTopic}
              maxLength="64"
              pattern="[A-Za-z0-9_\-]*"
              placeholder={tr("예: alaseo-kim-3f9a (남이 못 맞힐 이름으로)")}
            />
          </label>
          <label>{tr("ntfy 서버 · 직접 운영할 때만")}<input name="ntfyServer" type="url" defaultValue={settings.ntfyServer} placeholder="https://ntfy.sh" />
          </label>
        </div>
        <div className="login-actions">
          <button className="primary">{tr("저장")}</button>
          <button
            type="button"
            onClick={() =>
              action(async () => {
                const r = await api("/notifications/test", {});
                setStatus(
                  Object.entries(r).length
                    ? Object.entries(r)
                        .map(([k, ok]) => f("{0} {1}", k === "desktop" ? tr("PC 알림") : "ntfy", ok ? tr("전송") : tr("실패")))
                        .join(" · ")
                    : tr("켜진 알림 채널이 없습니다."),
                );
              })
            }
          >{tr("테스트 알림 보내기")}</button>
        </div>
      </form>
      <p role="status" className="fine">{status}</p>
      <p className="fine">{tr("ntfy는 계정 없이 주제 이름만으로 동작하는 공개 서비스라, 주제 이름을 아는 사람은 알림을 볼 수 있습니다. 알림에는 이용처와 금액이 들어가니 추측하기 어려운 이름을 쓰세요.")}</p>
    </section>
  );
}
function BankAccounts({ state }) {
  if (!state.accountSummary.connected)
    return (
      <section className="bank-overview">
        <h2>{tr("계좌")}</h2>
        <p className="flow-note">{tr("아직 연결된 계좌가 없습니다. 연결과 설정에서 CODEF 정보를 입력하면 잔액과 입출금을 볼 수 있습니다.")}</p>
      </section>
    );
  return (
    <section className="bank-overview" aria-labelledby="bank-title">
      <div className="section-header">
        <h2 id="bank-title">{tr("계좌")}</h2>
        <span className="fine">
          {state.accountSummary.updatedAt
            ? dateTime(state.accountSummary.updatedAt)
            : ""}
        </span>
      </div>
      <div className="bank-total">
        <span>{tr("출금 가능")}</span>
        <strong>{won(state.accountSummary.availableCash)}</strong>
        <small>{f("전체 잔액 {0}", won(state.accountSummary.totalBalance))}</small>
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
          <summary>{tr("최근 입출금")}</summary>
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
const usd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (rate) => (rate > 0 ? "+" : rate < 0 ? "−" : "") + Math.abs(rate * 100).toFixed(2) + "%";
const signedWon = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + won(Math.abs(n));
// Toss Securities holdings: shown on their own, never counted as money to pay card bills with.
function Investments({ state }) {
  const inv = state.investments;
  if (!inv) return null;
  const tone = (n) => (n > 0 ? "gain" : n < 0 ? "loss" : undefined);
  return (
    <section className="bank-overview investments" aria-labelledby="invest-title">
      <div className="section-header">
        <h2 id="invest-title">{tr("투자 자산")}</h2>
        <span className="fine">{f("토스증권 {0} · {1}", inv.account, dateTime(inv.at))}</span>
      </div>
      <div className="bank-total">
        <span>{tr("평가금액")}</span>
        <strong>
          {won(inv.value.krw)}
          {inv.value.usd > 0 && <> + {usd(inv.value.usd)}</>}
        </strong>
        <small>
          <span className={tone(inv.profit.krw)}>{f("평가손익 {0} ({1})", signedWon(inv.profit.krw), pct(inv.profitRate))}</span>
          {" · "}
          {f("예수금 {0}", won(inv.cash.krw))}
          {inv.cash.usd > 0 && " + " + usd(inv.cash.usd)}
        </small>
      </div>
      {inv.items.length ? (
        <div className="account-list">
          {inv.items.map((item) => (
            <div className="account-row" key={item.market + item.symbol}>
              <span>
                {item.name} <small>{f("{0}주", item.quantity)}</small>
              </span>
              <strong>
                {item.currency === "USD" ? usd(item.value) : won(item.value)}{" "}
                <small className={tone(item.profitRate)}>{pct(item.profitRate)}</small>
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="flow-note">{tr("보유 중인 주식이 없습니다.")}</p>
      )}
      <p className="fine">{tr("투자 자산은 카드값·할부 판단의 쓸 수 있는 돈에 넣지 않습니다.")}</p>
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
    [category, setCategory] = useState("all"),
    [chatOpen, setChatOpen] = useState(false),
    [aiStatus, setAiStatus] = useState(null),
    [seenReviewAt, setSeenReviewAt] = useState(null),
    [lang, setLangState] = useState(getLang()),
    [mcpConfig, setMcpConfig] = useState(null),
    [mcpStatus, setMcpStatus] = useState(""),
    messagesRef = useRef(null),
    [detail, setDetail] = useState(null),
    [codex, setCodex] = useState(null),
    [login, setLogin] = useState(""),
    [bankMethod, setBankMethod] = useState("id"),
    [certificateType, setCertificateType] = useState("1"),
    [cardOrganization, setCardOrganization] = useState("0302"),
    [cardMethod, setCardMethod] = useState("id"),
    [cardCertificateType, setCardCertificateType] = useState("1"),
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
        throw Error(tr("분석이 오래 걸리고 있습니다. 잠시 후 다시 확인하세요."));
      await new Promise((resolve) => setTimeout(resolve, 800));
      data = await api("/overview?month=" + month);
      setState(data);
    }
    if (data.aiReview?.status === "error")
      throw Error(data.aiReview.error || tr("분석에 실패했습니다."));
    return data;
  };
  useEffect(() => {
    let alive = true;
    api("/session")
      .then((s) => {
        if (!alive) return;
        token = s.token;
        setSession(s);
        // the server words verdicts itself, so it has to know the language this browser picked
        api("/language", { lang: getLang() }).then(() => refresh()).catch(() => {});
        setConnectionProvider(s.connection.provider);
      })
      .catch((e) => setError(friendly(e.message)));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    refresh().catch((e) => setError(friendly(e.message)));
    const timer = setInterval(() => refresh().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [session, month]);
  const lastMessageId = state?.messages?.at(-1)?.id;
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMessageId, chatOpen, busy, tab]);
  // Poll the analysis progress fast while it runs, slowly otherwise, so the panel keeps
  // reporting even after the user moves to another tab.
  useEffect(() => {
    if (!session) return;
    let alive = true,
      timer;
    const poll = async () => {
      try {
        const s = await api("/ai-status");
        if (!alive) return;
        setAiStatus(s);
        timer = setTimeout(poll, s.reviewBusy ? 2000 : 10000);
      } catch {
        if (alive) timer = setTimeout(poll, 10000);
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [session]);
  // A finished analysis shows up right away instead of waiting for the 15s refresh.
  useEffect(() => {
    if (aiStatus?.lastReviewAt && !aiStatus.reviewBusy) refresh().catch(() => {});
  }, [aiStatus?.lastReviewAt, aiStatus?.reviewBusy]);
  // Seeing the spending tab is what dismisses the "finished" notice.
  useEffect(() => {
    if (tab === "spending" && aiStatus?.lastReviewAt && !aiStatus.reviewBusy)
      setSeenReviewAt(aiStatus.lastReviewAt);
  }, [tab, aiStatus?.lastReviewAt, aiStatus?.reviewBusy]);
  useEffect(() => onLangChange(setLangState), []);
  const langSwitch = (
    <div className="lang-switch" role="group" aria-label={tr("언어")}>
      {[
        ["ko", "한국어"],
        ["en", "English"],
      ].map(([code, name]) => (
        <button
          key={code}
          aria-pressed={lang === code}
          onClick={() => {
            setLang(code);
            api("/language", { lang: code }).then(() => refresh()).catch(() => {});
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
  useEffect(() => {
    document.title = tr("알아서 — 일단 써. 나머진 알아서.");
  }, [lang]);
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
      message: messages.pending || tr("처리 중입니다."),
    });
    try {
      const result = await fn();
      setToast({
        type: "success",
        message: messages.success || tr("완료되었습니다."),
      });
      toastTimer.current = setTimeout(() => setToast(null), 1500);
      return result;
    } catch (e) {
      setToast({ type: "error", message: friendly(e.message) });
      toastTimer.current = setTimeout(() => setToast(null), 2500);
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
  async function registerCard(e) {
    e.preventDefault();
    await action(async () => {
      const form = e.currentTarget,
        data = new FormData(form),
        common = {
          method: cardMethod,
          organization: cardOrganization,
          birthDate: data.get("birthDate") || "",
        },
        cardConnection = await api(
          "/card/register",
          cardMethod === "certificate"
            ? {
                ...common,
                certType: cardCertificateType,
                derFile: await readCertificateFile(data.get("derFile")),
                keyFile: await readCertificateFile(data.get("keyFile")),
                certFile: await readCertificateFile(data.get("certFile")),
                certificatePassword: data.get("certificatePassword"),
              }
            : {
                ...common,
                loginId: data.get("loginId"),
                loginPassword: data.get("loginPassword"),
                cardNo: data.get("cardNo") || "",
                cardPassword: data.get("cardPassword") || "",
              },
        );
      setSession((current) => ({ ...current, cardConnection }));
      form
        .querySelectorAll('input[type="password"], input[type="file"]')
        .forEach((input) => (input.value = ""));
    });
  }
  async function syncCard(e) {
    e.preventDefault();
    await action(() =>
      syncCardData(Object.fromEntries(new FormData(e.currentTarget))),
    );
  }
  async function connectToss(e) {
    e.preventDefault();
    const form = e.currentTarget;
    await action(async () => {
      const result = await api("/toss/connection", Object.fromEntries(new FormData(form)));
      setSession((current) => ({ ...current, tossConnection: result.status }));
      setState(result.overview);
      form.reset();
    }, { pending: tr("토스증권 키를 확인하는 중입니다."), success: tr("토스증권을 연결했습니다.") });
  }
  async function syncToss() {
    const result = await api("/toss/sync", {});
    setSession((current) => ({ ...current, tossConnection: result.status }));
    setState(result.overview);
  }
  async function syncCardData(data) {
    const result = await api("/card/sync", data);
    setSession((current) => ({
      ...current,
      cardConnection: result.status,
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
    if (!window.confirm(f("{0} 연결을 끊을까요? 저장된 거래내역은 유지됩니다.", connection.alias || connection.display))) return;
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
  // The server sends Korean category names; translate them here so one dictionary covers everything.
  const cats = Object.fromEntries(
    Object.entries(session?.categories || {}).map(([k, v]) => [k, tr(v)]),
  );
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
        .filter((row) => category === "all" || (row.kind === "card" && row.category === category))
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
      <a className="skip" href="#content">{tr("본문으로 이동")}</a>
      <aside className="rail">
        <a
          href="#plan"
          className="brand"
          aria-label={tr("알아서 홈")}
          onClick={() => navigate("plan")}
        >
          <span className="brand-row">
            <Mark />
            <span className="brand-name">{tr("알아서")}<span className="brand-dot" aria-hidden="true">.</span>
            </span>
          </span>
          <span className="brand-tagline">{tr("일단 써.")}<br />{tr("나머진")} <b>{tr("알아서.")}</b>
          </span>
        </a>
        <nav aria-label={tr("주 메뉴")}>
          {[
            ["plan", tr("이번 달 계획")],
            ["spending", tr("지출 살펴보기")],
            ["invest", tr("투자")],
            ["settings", tr("연결과 설정")],
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
            aria-current={chatOpen ? "true" : undefined}
            onClick={() => {
              if (tab !== "plan") navigate("plan");
              setChatOpen(true);
              setTimeout(() => document.querySelector("#message")?.focus({ preventScroll: true }), 50);
            }}
          >{tr("대화")}</button>
        </nav>
        <AiProgress
          status={aiStatus}
          seenAt={seenReviewAt}
          onOpen={() => navigate("spending")}
        />
        {langSwitch}
        <div className="rail-bottom">
          <span className="dot" />{tr("개인 PC에서 실행 중")}<p>{tr("자료는 이 기기에만 저장됩니다.")}<br />
            {tr("계좌")} {session?.bankConnection?.connected ? tr("연결됨") : tr("연결 안 됨")}
            {session?.cardConnection?.connected ? tr(" · 카드 연결됨") : ""}
          </p>
        </div>
      </aside>
      <div className="body">
        <header className="topbar">
          <label className="month-label">{tr("계획 월")}<input
              aria-label={tr("계획 월")}
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
                  if (session?.cardConnection?.ready)
                    await syncCardData({
                      from: defaultBankFrom(),
                      to: inputDate(),
                    });
                  await refresh(true);
                },
                {
                  pending: tr("카드와 연결 계좌 자료를 가져와 분석하고 있습니다."),
                  success: tr("자료와 분석을 최신 상태로 반영했습니다."),
                },
              )
            }
          >{tr("자료 새로 읽기")}</button>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")} aria-label={tr("오류 닫기")}>{tr("닫기")}</button>
          </div>
        )}
        {toast && (
          <div
            className={`action-toast ${toast.type}`}
            role={toast.type === "error" ? "alert" : "status"}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <span className="toast-mark" aria-hidden="true">
              {toast.type === "pending" ? (
                <span className="spinner" />
              ) : toast.type === "success" ? (
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5 10 17.5 19 7" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24">
                  <path d="M12 7v7" />
                  <path d="M12 17.4v.2" />
                </svg>
              )}
            </span>
            <p>{toast.message}</p>
          </div>
        )}
        <main id="content">
          <h1 className="sr-only">
            {tab === "spending"
              ? tr("지출")
              : tab === "invest"
                ? tr("투자")
                : tab === "settings"
                ? tr("연결과 설정")
                : tr("이번 달 계획")}
          </h1>
          {!state ? (
            <p role="status">{tr("저장된 자료를 읽고 있습니다.")}</p>
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
                      pending: tr("거래를 다시 분석하고 있습니다."),
                      success: tr("분석을 완료했습니다."),
                    })
                  }
                  onInstallment={(t, months) =>
                    action(() =>
                      tool("set_installment", { id: t.id, source: t.source, months }),
                    )
                  }
                  onDiscuss={(t) => {
                    navigate("plan");
                    setMessage(
                      t.advice
                        ? f("{0} {1} 건, 화면에는 \"{2}\"라고 나오는데 다른 방법도 있는지 보고 필요하면 계획을 조정해줘.", t.merchant, won(t.amount), t.advice.text)
                        : f("{0} {1} {2} 거래를 소득과 예산 기준으로 자세히 분석해줘. 납부 상태와 확인된 할부 조건만 근거로 사용해줘.", t.date, t.merchant, won(t.amount)),
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
                    <GettingStarted session={session} state={state} navigate={navigate} />
                    <section className="summary">
                      <p className="section-label">{tr("이번 달 배분")}</p>
                      {plan.ready ? (
                        <>
                          <div className="lead-amount">
                            {won(plan.free)}
                            <span>
                              {plan.shortage
                                ? tr("필수 예산 부족")
                                : tr("배분 후 남는 돈")}
                            </span>
                          </div>
                          <div className="summary-lines">
                            {!!state.profile.annualGross && (
                              <span>
                                {f("계약연봉 세전 {0}", won(state.profile.annualGross))}
                              </span>
                            )}
                            <span>
                              {plan.incomeEstimated ? tr("예상 실수령") : tr("실수령")}{" "}
                              {won(plan.income)}
                            </span>
                            <span>
                              {state.accountSummary.connected
                                ? f("연결 계좌 출금 가능 {0}", won(state.accountSummary.availableCash))
                                : f("현재 잔액 {0}", won(state.profile.balance))}
                            </span>
                            {state.profile.payday && (
                              <span>{f("월급일 매월 {0}일", state.profile.payday)}</span>
                            )}
                            <span>{f("고정비 {0}", won(plan.fixedTotal))}</span>
                            <span>{f("기존 상환 {0}", won(plan.debt))}</span>
                            {plan.installments > 0 && (
                              <span>{f("할부 상환 {0}", won(plan.installments))}</span>
                            )}
                          </div>
                          {plan.provisional && (
                            <p className="notice">
                              {plan.incomeEstimated
                                ? f("{0}년 기준 예상값 · {1} · 실제 급여 입력 시 자동 대체", plan.incomeEstimate.year, tr(plan.incomeEstimate.assumption))
                                : tr("전체 월 내역이 없어 임시 배분입니다. 현재 확인된 지출만 반영했습니다.")}
                            </p>
                          )}
                          {plan.conflicts?.map((t) => (
                            <p className="notice" key={t}>
                              {t}
                            </p>
                          ))}
                          {plan.unconfirmed > 0 && (
                            <p className="notice">
                              {f("고정비 후보 {0}곳은 확인 전이라 고정비로 확정하지 않았습니다.", plan.unconfirmed)}
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <h2>{tr("월 소득 입력")}</h2>
                          <p className="flow-note">{tr("아래에 월 소득을 입력하면 고정비와 생활비를 나눠 계산합니다.")}</p>
                          {state.profile && (
                            <p className="summary-lines">
                              {!!state.profile.annualGross && (
                                <span>
                                  {f("계약연봉 세전 {0}", won(state.profile.annualGross))}
                                </span>
                              )}
                              <span>{f("현재 잔액 {0}", won(state.profile.balance))}</span>
                              {state.profile.payday && (
                                <span>{f("월급일 매월 {0}일", state.profile.payday)}</span>
                              )}
                            </p>
                          )}
                        </>
                      )}
                    </section>
                    <BankAccounts state={state} />
                    <Investments state={state} />
                    <details className="profile" open={!state.profile}>
                      <summary>
                        {f("현금 흐름과 목표 {0}", state.profile ? tr("수정") : tr("입력"))}
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
                              cardDueDay:
                                f.cardDueDay === "" ? null : Number(f.cardDueDay),
                              interestFreeMonths: Number(f.interestFreeMonths),
                              installmentRate: Number(f.installmentRate),
                            }),
                          );
                        }}
                      >
                        <div className="form-grid">
                          <Amount
                            label={tr("연간 세전 계약연봉")}
                            name="annualGross"
                            value={state.profile?.annualGross || null}
                            optional
                            placeholder={tr("예: 32000000")}
                          />
                          <Amount
                            label={tr("월 실수령 소득")}
                            name="income"
                            value={state.profile?.income || null}
                            optional
                            placeholder={tr("비우면 연봉으로 추정")}
                          />
                          <Amount
                            label={tr("현재 통장 잔액")}
                            name="balance"
                            value={state.profile?.balance ?? 0}
                          />
                          <label>{tr("월급일")}<span className="input-unit">
                              <input
                                name="payday"
                                type="number"
                                min="1"
                                max="31"
                                step="1"
                                defaultValue={state.profile?.payday ?? ""}
                                placeholder={tr("예: 5")}
                              />
                              <span>{tr("일")}</span>
                            </span>
                          </label>
                          <label>{tr("카드 결제일 · 선택")}<span className="input-unit">
                              <input
                                name="cardDueDay"
                                type="number"
                                min="1"
                                max="31"
                                step="1"
                                defaultValue={state.profile?.cardDueDay ?? ""}
                                placeholder={tr("예: 14")}
                              />
                              <span>{tr("일")}</span>
                            </span>
                          </label>
                          <label>{tr("카드 무이자 개월")}<span className="input-unit">
                              <input
                                name="interestFreeMonths"
                                type="number"
                                min="0"
                                max="12"
                                step="1"
                                defaultValue={state.profile?.interestFreeMonths ?? 3}
                              />
                              <span>{tr("개월")}</span>
                            </span>
                          </label>
                          <label>{tr("그 이상 할부 수수료 · 연")}<span className="input-unit">
                              <input
                                name="installmentRate"
                                type="number"
                                min="0"
                                max="40"
                                step="0.1"
                                defaultValue={state.profile?.installmentRate ?? 15}
                              />
                              <span>%</span>
                            </span>
                          </label>
                          <Amount
                            label={tr("기존 대출·할부 월 상환액")}
                            name="debt"
                            value={state.profile?.debt ?? 0}
                          />
                          <Amount
                            label={tr("저축 목표")}
                            name="savings"
                            value={state.profile?.savings}
                            optional
                          />
                          <Amount
                            label={tr("비상자금 적립")}
                            name="reserve"
                            value={state.profile?.reserve}
                            optional
                          />
                        </div>
                        <p className="flow-note">{tr("저축과 비상자금을 비우면 소득의 20%, 10%로 시작합니다. 카드 할부는 거래에서 이미 반영되므로 상환액에 다시 넣지 마세요.")}</p>
                        <button className="primary">{tr("정보 반영")}</button>
                      </form>
                    </details>
                    {plan.ready && (
                      <section className="allocations">
                        <div className="section-header">
                          <h2>{tr("월 예산")}</h2>
                        </div>
                        <p className="flow-note">
                          {f("{0} 지출을 바탕으로 고정비와 내가 정한 예산을 먼저 채우고 남는 금액을 나눴습니다.", plan.baseMonths.join(", "))}
                        </p>
                        <div className="allocation-row">
                          <div>
                            {tr("저축")}{" "}
                            <small>
                              {plan.defaults.savings
                                ? tr("자동 제안")
                                : tr("설정한 목표")}
                            </small>
                          </div>
                          <strong>{won(plan.savings)}</strong>
                          <span className="fine">
                            {f("목표 {0}", won(plan.targetSavings))}
                          </span>
                        </div>
                        <div className="allocation-row">
                          <div>{tr("비상자금")}</div>
                          <strong>{won(plan.reserve)}</strong>
                          <span className="fine">
                            {f("목표 {0}", won(plan.targetReserve))}
                          </span>
                        </div>
                        {plan.allocations.map((a) => (
                          <div className="allocation-row" key={a.category}>
                            <div>
                              {tr(a.label)}{" "}
                              {a.protected && (
                                <small className="protected">{tr("내가 정한 예산")}</small>
                              )}
                            </div>
                            <strong>{won(a.amount)}</strong>
                            <span className="fine">
                              {a.fixedBudget > 0
                                ? tr("고정비 ") + won(a.fixedBudget) + tr(" 별도 · ")
                                : ""}
                              {f("변동 지출 {0}", won(a.actual - a.fixedActual))}
                              {a.actual - a.fixedActual > a.amount
                                ? tr(" · 예산 초과")
                                : ""}
                            </span>
                          </div>
                        ))}
                        {!plan.allocations.length && (
                          <p className="empty">{tr("거래를 가져오면 항목별 생활비를 제안합니다.")}</p>
                        )}
                      </section>
                    )}
                    <section className="preferences">
                      <h2>{tr("내 지출 기준")}</h2>
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
                                {p.month === "always" ? tr("매달") : p.month + tr("만")}{" "}
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
                            >{tr("해제")}</button>
                          </div>
                        ))
                      ) : (
                        <p className="flow-note">
                          {tr("아직 없습니다. 대화에서 \"매달 술값 30만원\"처럼 말하면 여기에 반영됩니다.")}
                        </p>
                      )}
                      <details>
                        <summary>{tr("직접 지출 선호 입력")}</summary>
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
                            <label>{tr("지출 항목")}<select name="category">
                                {Object.entries(cats).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Amount label={tr("항목의 총 월 예산")} name="amount" />
                            <label>{tr("적용 기간")}<select name="month">
                                <option value="always">{tr("매달 유지")}</option>
                                <option value="current">{tr("선택한 달만")}</option>
                              </select>
                            </label>
                            <label>{tr("이유")}<input
                                name="note"
                                maxLength="300"
                                placeholder={tr("예: 친구들과 주말 약속")}
                              />
                            </label>
                          </div>
                          <button>{tr("계획에 반영")}</button>
                        </form>
                      </details>
                    </section>
                    <PurchaseGoals
                      goals={state.goals}
                      plan={plan}
                      onSave={(goal) =>
                        action(() => tool("set_purchase_goal", goal))
                      }
                      onRemove={(id, name) =>
                        confirm(f("{0} 구매 목표를 지울까요?", name)) &&
                        action(() => tool("remove_purchase_goal", { id }))
                      }
                      onDiscuss={(goal) => {
                        setMessage(
                          f("{0} {1} 구매 목표가 있고 지금 {2}을 따로 모았어. 현재 지출과 배분을 기준으로 무리 없이 살 수 있는 시점과 줄일 수 있는 지출을 분석해줘. 확인된 할부 조건이 없으면 수수료나 개월 수를 지어내지 마.", goal.name, won(goal.price), won(goal.saved)),
                        );
                        setTimeout(
                          () => document.querySelector("#message")?.focus(),
                          0,
                        );
                      }}
                    />
                  </div>
                  <section className={"chat" + (chatOpen ? " open" : "")} aria-label={tr("재무 대화")}>
                    <div className="section-header">
                      <h2>{tr("대화로 조정")}</h2>
                      <button type="button" className="quiet sheet-close" onClick={() => setChatOpen(false)}>{tr("닫기")}</button>
                      <span className="fine">
                        {session.connection.provider === "codex"
                          ? tr("Codex 구독 · 웹검색")
                          : session.connection.provider + tr(" API · 웹검색")}
                      </span>
                    </div>
                    <div className="messages" aria-live="polite" ref={messagesRef}>
                      {state.messages.length ? (
                        state.messages.map((m) => (
                          <article key={m.id} className={"message " + m.role}>
                            <span className="message-label">
                              {m.role === "user" ? tr("나") : tr("재무 도우미")}
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
                                    ? settingsOnly(m.proposal) ? tr("저장됨") : tr("계획에 반영됨")
                                    : settingsOnly(m.proposal) ? tr("이대로 저장") : tr("이 조건으로 재배분")}
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
                                  >{tr("변경안 다시 계산")}</button>
                                )}
                              </div>
                            )}
                          </article>
                        ))
                      ) : (
                        <div className="chat-empty">
                          <p className="chat-motto">{tr("쓰는 건, 당신답게.")}<br />{tr("관리는 알아서.")}</p>
                          <p>{tr("이렇게 말해보세요")}</p>
                          {[
                            tr("매달 술값은 30만원 정도 쓸 것 같아"),
                            tr("내 지출에서 줄일 만한 부분을 알려줘"),
                            tr("고정비로 보이는 내역을 설명해줘"),
                          ].map((t) => (
                            <button key={t} onClick={() => setMessage(t)}>
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                      {busy && (
                        <p role="status">{tr("거래와 계획을 확인하고 있습니다…")}</p>
                      )}
                    </div>
                    <form onSubmit={send}>
                      <label className="sr-only" htmlFor="message">{tr("계획에 대한 요청")}</label>
                      <textarea
                        id="message"
                        disabled={busy}
                        value={message}
                        maxLength="4000"
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={tr("제품을 찾아 목표로 추가해줘")}
                        rows="3"
                      />
                      <div className="chat-actions">
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => navigate("settings")}
                        >{tr("AI 연결 설정")}</button>
                        <button
                          className="primary"
                          disabled={busy || !message.trim()}
                        >
                          {busy ? tr("분석 중") : tr("보내기")}
                        </button>
                      </div>
                    </form>
                    <p className="flow-note">{tr("거래·소득·최근 대화가 선택한 AI에 전달됩니다. 제품 검색은 웹검색을 씁니다.")}</p>
                  </section>
                </div>
              )}
              {tab === "spending" && (
                <>
                  <section className="spend-summary">
                    <div>
                      <p className="section-label">
                        {analysis.complete
                          ? tr("조회 기간 전체 자료")
                          : tr("확보된 자료 범위")}
                      </p>
                      <div className="lead-amount">
                        {won(analysis.total)}
                        <span>
                          {f("취소·거절 제외 승인금액 · {0}건", analysis.count)}
                        </span>
                      </div>
                    </div>
                    <p className="flow-note">
                      {analysis.complete
                        ? tr("이 달 전체 내역이 확인된 자료입니다.")
                        : tr("가져온 자료만 집계했습니다. 월 전체 합계나 전월 비교로 보기엔 부족할 수 있습니다.")}
                      {analysis.partial ? tr(" 부분취소 거래는 남은 금액을 확인하세요.") : ""}
                      {analysis.duplicates > 0
                        ? f(" 다른 출처에 같은 거래가 있는 {0}건은 두 번 세지 않도록 합계에서 뺐습니다.", analysis.duplicates)
                        : ""}
                    </p>
                  </section>
                  {session.bankConnection.ready && (
                    <section className="account-cashflow" aria-labelledby="cashflow-title">
                      <div className="section-header">
                        <h2 id="cashflow-title">{tr("계좌 현금흐름")}</h2>
                        <span className="fine">{month}</span>
                      </div>
                      {state.accountSummary.connected ? (
                        <>
                          <div className="cashflow-values">
                            <p>
                              <span>{tr("입금")}</span>
                              <strong className="in">+{won(state.bankCashflow.incoming)}</strong>
                            </p>
                            <p>
                              <span>{tr("출금")}</span>
                              <strong className="out">−{won(state.bankCashflow.outgoing)}</strong>
                            </p>
                            <p>
                              <span>{tr("순변동")}</span>
                              <strong>{state.bankCashflow.net >= 0 ? "+" : "−"}{won(Math.abs(state.bankCashflow.net))}</strong>
                            </p>
                          </div>
                          <p className="flow-note">{tr("계좌이체·카드대금이 포함된 실제 통장 움직임입니다. 카드 승인 지출과는 합치지 않아 중복을 막고, AI가 급여와 반복 이체를 함께 살펴봅니다.")}</p>
                          {!!state.bankCashflow.count && (
                            <details>
                              <summary>{f("이 달 입출금 {0}건", state.bankCashflow.count)}</summary>
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
                          <p>{tr("계좌는 연결됐지만 입출금 자료를 아직 가져오지 못했습니다.")}</p>
                          <button className="quiet" onClick={() => navigate("settings")}>{tr("동기화 설정으로 이동")}</button>
                        </div>
                      )}
                    </section>
                  )}
                  <div className="spend-grid">
                    <section>
                      <h2>{tr("항목별 지출")}</h2>
                      {Object.entries(analysis.totals)
                        .filter(([, n]) => n > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => (
                          <button
                            type="button"
                            className={"category-row" + (category === k ? " active" : "")}
                            key={k}
                            aria-pressed={category === k}
                            title={cats[k] + tr(" 거래만 장부에서 보기")}
                            onClick={() => {
                              setCategory(category === k ? "all" : k);
                              document.querySelector(".ledger-section")?.scrollIntoView({ block: "start" });
                            }}
                          >
                            <span>{cats[k]}</span>
                            <meter
                              aria-label={cats[k] + tr(" 비중")}
                              min="0"
                              max={Math.max(analysis.total, 1)}
                              value={v}
                            />
                            <strong>{won(v)}</strong>
                            <small>
                              {((v / analysis.total) * 100).toFixed(1)}%
                            </small>
                          </button>
                        ))}
                      {!analysis.count && (
                        <p className="empty">{tr("선택한 달의 거래가 없습니다.")}</p>
                      )}
                    </section>
                    <section>
                      <h2>{tr("고정비로 보이는 결제")}</h2>
                      {analysis.candidates.filter((c) => !c.dismissed)
                        .length ? (
                        analysis.candidates
                          .filter((c) => !c.dismissed)
                          .map((c) => (
                            <div className="candidate" key={c.merchant}>
                              <strong>{c.merchant}</strong>
                              <p>
                                {won(c.amount)} · {tr(c.reason)}
                              </p>
                              <p className="fine">
                                {f("최근 이용일 {0} ·", c.lastDate)}{" "}
                                {c.confirmed
                                  ? tr("고정비로 반영 중")
                                  : tr("확인 전 후보")}
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
                                {c.confirmed ? tr("고정비 해제") : tr("고정비로 반영")}
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
                                >{tr("고정비 아님")}</button>
                              )}
                            </div>
                          ))
                      ) : (
                        <p className="flow-note">{tr("3개월 이상 비슷한 날짜와 금액으로 결제된 곳이 있으면 여기에 보입니다. 거래 상세에서 직접 지정할 수도 있습니다.")}</p>
                      )}
                    </section>
                  </div>
                  <section className="ledger-section">
                    <div className="section-header">
                      <h2>{tr("거래 장부")}</h2>
                      <span className="fine">{tr("카드 승인과 계좌 입출금을 날짜순으로 봅니다")}</span>
                    </div>
                    <div className="filters">
                      <label>{tr("내역 검색")}<input
                          type="search"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <label>{tr("내역 필터")}<select
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                        >
                          <option value="all">{tr("전체")}</option>
                          <option value="in">{tr("입금")}</option>
                          <option value="out">{tr("출금")}</option>
                          <option value="paid">{tr("선납·납부 확인")}</option>
                          <option value="unpaid">{tr("미납")}</option>
                          <option value="bank">{tr("계좌")}</option>
                          <option value="card">{tr("카드")}</option>
                        </select>
                      </label>
                      <label>{tr("항목")}<select value={category} onChange={(e) => setCategory(e.target.value)}>
                          <option value="all">{tr("전체")}</option>
                          {Object.entries(cats).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="table-scroll">
                      <table className="ledger">
                        <thead>
                          <tr>
                            <th>{tr("일자")}</th>
                            <th>{tr("내역")}</th>
                            <th>{tr("구분")}</th>
                            <th>{tr("금액")}</th>
                            <th>{tr("상태")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerRows.map((t) => (
                              <tr key={`${t.kind}:${t.id}`} className={t.duplicate ? "duplicate" : undefined}>
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
                                      ? t.duplicate
                                        ? tr("카드 · 다른 출처와 중복이라 합계에서 제외")
                                        : t.installment ? f("카드 · {0}개월 할부 (월 {1})", t.installment.months, won(t.installment.monthly)) : tr("카드")
                                      : `${session.bankOptions.find((bank) => bank.value === t.account?.organization)?.label ? tr(session.bankOptions.find((bank) => bank.value === t.account?.organization).label) : tr("계좌")} ${t.account?.display || ""}`}
                                  </small>
                                </td>
                                <td>
                                  {t.kind === "card" ? <div className="classification">
                                    <select
                                      aria-label={t.merchant + tr(" 항목")}
                                      disabled={!!t.duplicate}
                                      title={t.duplicate ? tr("합계에 들어가는 쪽에서 바꾸세요.") : undefined}
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
                                          ? tr("정정 반영")
                                          : t.aiCategory
                                            ? t.aiCategory.confidence === "low"
                                              ? tr("AI 판단 보류")
                                              : t.aiCategory.confidence ===
                                                  "medium"
                                                ? tr("AI 추정")
                                                : tr("AI 분류")
                                            : tr("분석 대기")}
                                    </small>
                                  </div> : null}
                                </td>
                                <td className={`numeric ${t.kind === "bank" ? t.direction : ""}`}>
                                  {t.kind === "bank" ? (t.direction === "in" ? "+" : "−") : ""}{won(t.amount)}
                                </td>
                                <td className={"status " + (t.kind === "bank" ? t.direction : t.status)}>
                                  {t.kind === "bank" ? (t.direction === "in" ? tr("입금") : tr("출금")) : tr(labels[t.status])}
                                </td>
                              </tr>
                            ))}
                          {!ledgerRows.length && (
                            <tr>
                              <td colSpan="5" className="empty">
                                {category !== "all" && ["bank", "in", "out"].includes(status)
                                  ? tr("계좌 입출금에는 지출 항목이 없습니다. 항목을 전체로 두거나 카드만 보세요.")
                                  : tr("조건에 맞는 내역이 없습니다.")}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {tab === "invest" && <InvestPanel session={session} action={action} navigate={navigate} />}
              {tab === "settings" && (
                <div className="settings">
                  <section className="language-section">
                    <h2>{tr("언어")}</h2>
                    {langSwitch}
                  </section>
                  <section>
                    <h2>{tr("계좌 연결")}</h2>
                    <p className="flow-note">{tr("CODEF 읽기 권한으로 계좌 잔액과 입출금을 가져와 이 기기에 저장합니다.")}</p>
                    <p className="connection-status">
                      {session.bankConnection.ready
                        ? tr("계좌가 연결되어 있습니다")
                        : session.bankConnection.connected
                          ? tr("CODEF 키는 저장됐고, 아래에서 은행 인증을 마치면 됩니다")
                          : tr("아직 연결하지 않았습니다")}
                      {session.bankConnection.organizations?.length
                        ? f(" · 은행 {0}곳", session.bankConnection.organizations.length)
                        : ""}
                      {state?.accounts?.length
                        ? f(" · 계좌 {0}개", state.accounts.length)
                        : ""}
                      {session.bankConnection.methods?.length
                        ? ` · ${session.bankConnection.methods.map((method) => tr(bankMethodLabels[method] || method)).join(" + ")}`
                        : ""}
                    </p>
                    <div className="connected-account-summary" aria-label={tr("연결된 계좌 요약")}>
                      <div className="section-header">
                        <h3>{tr("연결된 계좌")}</h3>
                        <span className="fine">
                          {state?.accountSummary?.updatedAt
                            ? f("최근 동기화 {0}", dateTime(state.accountSummary.updatedAt))
                            : tr("아직 동기화하지 않음")}
                        </span>
                      </div>
                      <div className="account-list">
                        {state?.accounts?.length
                          ? state.accounts.map((account) => (
                              <div className="account-row" key={account.id}>
                                <span>
                                  {tr(session.bankOptions.find((bank) => bank.value === account.organization)?.label || account.organization)}
                                  <small>{account.name} · {account.display}</small>
                                </span>
                                <strong>{won(account.available)}</strong>
                              </div>
                            ))
                          : session.bankConnection.organizations?.map((organization) => (
                              <div className="account-row" key={organization}>
                                <span>
                                  {tr(session.bankOptions.find((bank) => bank.value === organization)?.label || organization)}
                                  <small>{tr("계좌 내역 확인 전")}</small>
                                </span>
                                <small>{session.bankConnection.methods.map((method) => tr(bankMethodLabels[method] || method)).join(" + ")}</small>
                              </div>
                            ))}
                      </div>
                    </div>
                    {session.bankConnection.quickConnections?.length > 0 && (
                      <div className="linked-accounts" aria-label={tr("연결된 빠른조회 계좌")}>
                        {session.bankConnection.quickConnections.map((connection) => {
                          const editType =
                            quickEditTypes[connection.id] || connection.credentialType;
                          return (
                            <form key={connection.id} onSubmit={updateQuickBank} autoComplete="off">
                              <input type="hidden" name="connectionId" value={connection.id} />
                              <label>{tr("별칭")}<input
                                  name="alias"
                                  maxLength="40"
                                  defaultValue={connection.alias}
                                  placeholder={tr("예: 월급 통장")}
                                />
                              </label>
                              <label>{tr("은행")}<select
                                  name="organization"
                                  defaultValue={connection.organization}
                                >
                                  {session.bankOptions.map((bank) => (
                                    <option key={bank.value} value={bank.value}>{tr(bank.label)}</option>
                                  ))}
                                </select>
                              </label>
                              <details className="quick-credentials">
                                <summary>{f("인증정보 수정 · {0}", connection.display)}</summary>
                                <div className="form-grid">
                                  <label>{tr("인증 방식")}<select
                                      name="credentialType"
                                      value={editType}
                                      onChange={(event) =>
                                        setQuickEditTypes((current) => ({
                                          ...current,
                                          [connection.id]: event.target.value,
                                        }))
                                      }
                                    >
                                      <option value="account">{tr("계좌번호 + 계좌 비밀번호")}</option>
                                      <option value="fast">{tr("조회전용 정보")}</option>
                                      <option value="id">{tr("인터넷뱅킹 ID")}</option>
                                    </select>
                                  </label>
                                  <button
                                    type="button"
                                    className="quiet credential-reveal"
                                    aria-label={revealedAccounts.includes(connection.id) ? tr("저장된 인증정보 숨기기") : tr("저장된 인증정보 보기")}
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
                                      <label>{tr("계좌번호")}<span className="account-input">
                                          <input
                                            name="account"
                                            data-secret
                                            inputMode="numeric"
                                            maxLength="40"
                                            required={connection.credentialType !== "account"}
                                            type="password"
                                            placeholder={tr("•••••••• · 저장됨")}
                                          />
                                        </span>
                                      </label>
                                      <label>{tr("계좌 비밀번호")}<input
                                          name="accountPassword"
                                          data-secret
                                          type="password"
                                          required={connection.credentialType !== "account"}
                                          maxLength="200"
                                          placeholder={tr("•••• · 저장됨")}
                                        />
                                      </label>
                                    </>
                                  )}
                                  {editType === "fast" && (
                                    <>
                                      <label>{tr("조회전용 아이디")}<input name="fastId" data-secret type="password" required={connection.credentialType !== "fast"} maxLength="200" placeholder={tr("•••••••• · 저장됨")} />
                                      </label>
                                      <label>{tr("조회전용 비밀번호")}<input name="fastPassword" data-secret type="password" required={connection.credentialType !== "fast"} maxLength="200" placeholder={tr("•••• · 저장됨")} />
                                      </label>
                                    </>
                                  )}
                                  {editType === "id" && (
                                    <>
                                      <label>{tr("계좌번호")}<input
                                          name="account"
                                          data-secret
                                          inputMode="numeric"
                                          required={connection.credentialType !== "id"}
                                          maxLength="40"
                                          type="password"
                                          placeholder={tr("•••••••• · 저장됨")}
                                        />
                                      </label>
                                      <label>{tr("계좌 비밀번호")}<input
                                          name="accountPassword"
                                          data-secret
                                          type="password"
                                          required={connection.credentialType !== "id"}
                                          maxLength="200"
                                          placeholder={tr("•••• · 저장됨")}
                                        />
                                      </label>
                                      <label>{tr("인터넷뱅킹 ID")}<input name="quickId" data-secret type="password" required={connection.credentialType !== "id"} maxLength="200" placeholder={tr("•••••••• · 저장됨")} />
                                      </label>
                                      <label>{tr("인터넷뱅킹 비밀번호")}<input name="quickPassword" data-secret type="password" required={connection.credentialType !== "id"} maxLength="200" placeholder={tr("•••• · 저장됨")} />
                                      </label>
                                    </>
                                  )}
                                  <label>{tr("생년월일 · 은행이 요구할 때")}<input name="identity" data-secret type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder={connection.hasIdentity ? tr("•••••• · 저장됨") : tr("YYMMDD · 선택")} />
                                  </label>
                                </div>
                              </details>
                              <div className="account-actions">
                                <button>{tr("저장")}</button>
                                <button
                                  type="button"
                                  className="quiet"
                                  onClick={() => disconnectQuick(connection)}
                                >{tr("연결 끊기")}</button>
                              </div>
                            </form>
                          );
                        })}
                      </div>
                    )}
                    <details open={!session.bankConnection.connected}>
                      <summary>
                        {session.bankConnection.connected ? tr("CODEF API 키 변경") : tr("CODEF API 키 입력")}
                      </summary>
                      <form onSubmit={connectBank} autoComplete="off">
                        <div className="form-grid">
                          <label>{tr("CODEF 환경")}<select name="environment" defaultValue={session.bankConnection.environment || "demo"}>
                              <option value="demo">{tr("데모")}</option>
                              <option value="production">{tr("운영")}</option>
                            </select>
                          </label>
                          <label>
                            Client ID
                            <input name="clientId" data-connection-secret type="password" required minLength="8" maxLength="300" placeholder={session.bankConnection.connected ? tr("•••••••• · 저장됨") : ""} />
                          </label>
                          <label>
                            Client Secret
                            <input name="clientSecret" data-connection-secret type="password" required minLength="8" maxLength="500" placeholder={session.bankConnection.connected ? tr("•••••••• · 저장됨") : ""} />
                          </label>
                          <label>
                            Public Key
                            <textarea name="publicKey" data-connection-secret required minLength="100" maxLength="2000" placeholder={session.bankConnection.connected ? tr("•••••••• · 저장됨") : ""} />
                          </label>
                          <label>{tr("Connected ID · 이미 있을 때만")}<input name="connectedId" data-connection-secret type="password" minLength="8" maxLength="300" placeholder={session.bankConnection.connectedId ? f("{0} · 저장됨", session.bankConnection.connectedId) : tr("없음")} />
                          </label>
                          {session.bankConnection.connected && (
                            <button
                              type="button"
                              className="quiet credential-reveal"
                              aria-label={revealedBankConnection ? tr("저장된 CODEF 연결정보 숨기기") : tr("저장된 CODEF 연결정보 보기")}
                              aria-pressed={revealedBankConnection}
                              onClick={(event) => toggleBankConnection(event.currentTarget.form)}
                            >
                              <EyeIcon hidden={revealedBankConnection} />
                            </button>
                          )}
                        </div>
                        <button className="primary">{tr("연결 정보 저장")}</button>
                      </form>
                    </details>
                    {session.bankConnection.connected && (
                      <details open={!session.bankConnection.ready}>
                        <summary>
                          {session.bankConnection.ready ? tr("은행 계좌 추가") : tr("은행 계정 등록")}
                        </summary>
                        <form onSubmit={registerBank} autoComplete="off">
                        <div className="form-grid">
                          <label>{tr("은행")}<select name="organization" required defaultValue="0088">
                              {session.bankOptions.map((bank) => (
                                <option key={bank.value} value={bank.value}>{tr(bank.label)}</option>
                              ))}
                            </select>
                          </label>
                          <label>{tr("연결 방식")}<select
                              name="method"
                              value={bankMethod}
                              onChange={(event) => setBankMethod(event.target.value)}
                            >
                              <option value="id">{tr("인터넷뱅킹 ID")}</option>
                              <option value="quick">{tr("빠른조회")}</option>
                              <option value="certificate">{tr("공동인증서")}</option>
                            </select>
                          </label>
                          {bankMethod === "id" && (
                            <>
                              <label>{tr("인터넷뱅킹 ID")}<input name="loginId" required maxLength="200" />
                              </label>
                              <label>{tr("인터넷뱅킹 비밀번호")}<input name="loginPassword" type="password" required maxLength="200" />
                              </label>
                            </>
                          )}
                          {bankMethod === "quick" && (
                            <>
                              <label>{tr("별칭 · 선택")}<input name="alias" maxLength="40" placeholder={tr("예: 생활비 통장")} />
                              </label>
                              <label>{tr("빠른조회 정보")}<select
                                  value={quickCredentialType}
                                  onChange={(event) =>
                                    setQuickCredentialType(event.target.value)
                                  }
                                >
                                  <option value="account">{tr("계좌번호 + 계좌 비밀번호")}</option>
                                  <option value="fast">{tr("조회전용 정보")}</option>
                                  <option value="id">{tr("인터넷뱅킹 ID")}</option>
                                </select>
                              </label>
                              {quickCredentialType === "account" && (
                                <>
                                  <label>{tr("계좌번호")}<input name="account" inputMode="numeric" required maxLength="40" />
                                  </label>
                                  <label>{tr("계좌 비밀번호")}<input name="accountPassword" type="password" required maxLength="200" />
                                  </label>
                                </>
                              )}
                              {quickCredentialType === "fast" && (
                                <>
                                  <label>{tr("조회전용 아이디")}<input name="fastId" required maxLength="200" />
                                  </label>
                                  <label>{tr("조회전용 비밀번호")}<input name="fastPassword" type="password" required maxLength="200" />
                                  </label>
                                </>
                              )}
                              {quickCredentialType === "id" && (
                                <>
                                  <label>{tr("계좌번호")}<input name="account" inputMode="numeric" required maxLength="40" />
                                  </label>
                                  <label>{tr("계좌 비밀번호")}<input name="accountPassword" type="password" required maxLength="200" />
                                  </label>
                                  <label>{tr("인터넷뱅킹 ID")}<input name="quickId" required maxLength="200" />
                                  </label>
                                  <label>{tr("인터넷뱅킹 비밀번호")}<input name="quickPassword" type="password" required maxLength="200" />
                                  </label>
                                </>
                              )}
                              <label>{tr("생년월일 · 은행이 요구할 때")}<input name="identity" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="YYMMDD" />
                              </label>
                            </>
                          )}
                          {bankMethod === "certificate" && (
                            <>
                              <label>{tr("인증서 형식")}<select
                                  name="certType"
                                  value={certificateType}
                                  onChange={(event) => setCertificateType(event.target.value)}
                                >
                                  <option value="1">DER + KEY</option>
                                  <option value="pfx">PFX / P12</option>
                                </select>
                              </label>
                              {certificateType === "pfx" ? (
                                <label>{tr("PFX 또는 P12 파일")}<input name="certFile" type="file" accept=".pfx,.p12" required />
                                </label>
                              ) : (
                                <>
                                  <label>{tr("인증서 DER 파일")}<input name="derFile" type="file" accept=".der,.cer" required />
                                  </label>
                                  <label>{tr("인증서 KEY 파일")}<input name="keyFile" type="file" accept=".key" required />
                                  </label>
                                </>
                              )}
                              <label>{tr("인증서 비밀번호")}<input name="certificatePassword" type="password" required maxLength="200" />
                              </label>
                            </>
                          )}
                          {bankMethod !== "quick" && (
                            <label>{tr("생년월일 · 은행이 요구할 때")}<input name="birthDate" inputMode="numeric" pattern="[0-9]{6}([0-9]{2})?" maxLength="8" placeholder={tr("YYMMDD 또는 YYYYMMDD")} />
                            </label>
                          )}
                        </div>
                        <button className="primary">
                          {bankMethod === "quick" ? tr("빠른조회 연결") : tr("은행 인증 후 연결")}
                        </button>
                        </form>
                      </details>
                    )}
                    {session.bankConnection.ready && (
                      <>
                        <form className="bank-sync" onSubmit={syncBank}>
                          <label>{tr("시작일")}<input name="from" type="date" required defaultValue={defaultBankFrom()} />
                          </label>
                          <label>{tr("종료일")}<input name="to" type="date" required defaultValue={inputDate()} />
                          </label>
                          <button className="primary">{tr("계좌 자료 동기화")}</button>
                        </form>
                        <button
                          className="quiet"
                          onClick={() => action(async () => {
                            const bankConnection = await api("/bank/connection", undefined, "DELETE");
                            setSession((current) => ({ ...current, bankConnection }));
                          })}
                        >{tr("연결 정보 지우기")}</button>
                      </>
                    )}
                    <p className="fine">{tr("ID 비밀번호와 인증서 파일은 등록 후 남기지 않습니다. 다시 동기화할 때 필요한 빠른조회 정보만 이 기기에 암호화 저장합니다. 계좌번호는 기본으로 가리고 보기 버튼을 눌렀을 때만 표시합니다. 이체는 지원하지 않습니다.")}</p>
                  </section>
                  <section>
                    <h2>{tr("카드 연결")}</h2>
                    <p className="flow-note">{tr("카드사를 선택해 승인내역과 월별 청구내역을 가져옵니다.")}</p>
                    <p className="connection-status">
                      {session.cardConnection?.ready
                        ? f("카드사 {0}곳 연결됨", session.cardConnection.cards.length)
                        : session.bankConnection.connected
                          ? tr("CODEF 키 저장됨 · 카드사 인증 필요")
                          : tr("먼저 위에서 CODEF API 키를 저장하세요")}
                    </p>
                    {!!session.cardConnection?.cards?.length && (
                      <div className="connected-account-summary" aria-label={tr("연결된 카드사")}>
                        <div className="section-header">
                          <h3>{tr("연결된 카드")}</h3>
                          <span className="fine">{f("{0}곳", session.cardConnection.cards.length)}</span>
                        </div>
                        <div className="account-list">
                          {session.cardConnection.cards.map((card) => (
                            <div className="account-row" key={card.organization}>
                              <span>{tr(card.name)}</span>
                              <strong>{card.display}</strong>
                              <small>{tr(bankMethodLabels[card.method] || card.method)}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {state?.cardSync && (
                      <div className="connected-account-summary" aria-label={tr("카드 동기화 요약")}>
                        <div className="section-header">
                          <h3>{tr("최근 동기화")}</h3>
                          <span className="fine">
                            {dateTime(state.cardSync.at)}
                          </span>
                        </div>
                        <div className="account-list">
                          <div className="account-row">
                            <span>{tr("승인내역")}</span>
                            <strong>{f("{0}건", state.cardSync.transactionCount)}</strong>
                          </div>
                          {state.cardSync.bills?.slice(-session.cardConnection.cards.length).map((bill) => (
                            <div className="account-row" key={`${bill.organization}-${bill.month}`}>
                              <span>{tr(bill.cardName)} · {f("{0}.{1} 청구", bill.month.slice(0, 4), bill.month.slice(4))}</span>
                              <strong>{won(bill.totalAmount)}</strong>
                              <small>
                                {f("미납 {0}", won(bill.outstanding))}
                                {bill.paymentDueDate ? f(" · {0} 납부", bill.paymentDueDate) : ""}
                              </small>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {session.bankConnection.connected && (
                      <details open={!session.cardConnection?.ready}>
                        <summary>
                          {session.cardConnection?.ready ? tr("카드사 추가 또는 다시 설정") : tr("카드사 인증")}
                        </summary>
                        <form onSubmit={registerCard} autoComplete="off">
                          <div className="form-grid">
                            <label>{tr("카드사")}<select
                                name="organization"
                                value={cardOrganization}
                                onChange={(event) => setCardOrganization(event.target.value)}
                              >
                                {session.cardOptions.map((card) => (
                                  <option key={card.value} value={card.value}>{tr(card.label)}</option>
                                ))}
                              </select>
                            </label>
                            <label>{tr("연결 방식")}<select
                                name="method"
                                value={cardMethod}
                                onChange={(event) => setCardMethod(event.target.value)}
                              >
                                <option value="id">{tr("카드사 ID")}</option>
                                <option value="certificate">{tr("공동인증서")}</option>
                              </select>
                            </label>
                            {cardMethod === "id" ? (
                              <>
                                <label>{tr("카드사 ID")}<input name="loginId" required maxLength="200" />
                                </label>
                                <label>{tr("카드사 비밀번호")}<input name="loginPassword" type="password" required maxLength="200" />
                                </label>
                                {["0301", "0302"].includes(cardOrganization) && (
                                  <>
                                    <label>
                                      {tr("카드번호")} {cardOrganization === "0301" ? tr("· 소지 확인 요청 시") : ""}
                                      <input name="cardNo" type="password" inputMode="numeric" required={cardOrganization === "0302"} minLength={cardOrganization === "0302" ? 12 : undefined} maxLength="23" />
                                    </label>
                                    <label>
                                      {tr("카드 비밀번호")} {cardOrganization === "0301" ? tr("앞 2자리 · 소지 확인 요청 시") : tr("4자리")}
                                      <input name="cardPassword" type="password" inputMode="numeric" pattern={cardOrganization === "0301" ? "[0-9]{2}" : "[0-9]{4}"} required={cardOrganization === "0302"} maxLength={cardOrganization === "0301" ? 2 : 4} />
                                    </label>
                                  </>
                                )}
                              </>
                            ) : (
                              <>
                                <label>{tr("인증서 형식")}<select
                                    name="certType"
                                    value={cardCertificateType}
                                    onChange={(event) => setCardCertificateType(event.target.value)}
                                  >
                                    <option value="1">DER + KEY</option>
                                    <option value="pfx">PFX / P12</option>
                                  </select>
                                </label>
                                {cardCertificateType === "pfx" ? (
                                  <label>{tr("PFX 또는 P12 파일")}<input name="certFile" type="file" accept=".pfx,.p12" required />
                                  </label>
                                ) : (
                                  <>
                                    <label>{tr("인증서 DER 파일")}<input name="derFile" type="file" accept=".der,.cer" required />
                                    </label>
                                    <label>{tr("인증서 KEY 파일")}<input name="keyFile" type="file" accept=".key" required />
                                    </label>
                                  </>
                                )}
                                <label>{tr("인증서 비밀번호")}<input name="certificatePassword" type="password" required maxLength="200" />
                                </label>
                              </>
                            )}
                            <label>{tr("생년월일 · 카드사가 요구할 때")}<input name="birthDate" inputMode="numeric" pattern="[0-9]{6}([0-9]{2})?" maxLength="8" placeholder={tr("YYMMDD 또는 YYYYMMDD")} />
                            </label>
                          </div>
                          <button className="primary">{tr("카드사 연결")}</button>
                        </form>
                      </details>
                    )}
                    {session.cardConnection?.ready && (
                      <form className="bank-sync" onSubmit={syncCard}>
                        <label>{tr("시작일")}<input name="from" type="date" required defaultValue={defaultBankFrom()} />
                        </label>
                        <label>{tr("종료일")}<input name="to" type="date" required defaultValue={inputDate()} />
                        </label>
                        <button className="primary">{tr("카드 자료 동기화")}</button>
                      </form>
                    )}
                    <p className="fine">{tr("카드사 로그인 비밀번호와 인증서 파일은 등록 후 남기지 않습니다. 현대카드와 KB카드 인증에 필요한 카드정보만 이 기기의 암호화 저장소에 보관합니다. 결제 신청은 하지 않습니다.")}</p>
                  </section>
                  <section>
                    <h2>{tr("토스증권")}</h2>
                    <p className="flow-note">{tr("보유 주식과 예수금을 가져와 투자 자산으로 따로 보여줍니다. 카드값·할부 판단의 쓸 수 있는 돈에는 넣지 않습니다.")}</p>
                    <p className="connection-status">
                      {session.tossConnection?.ready
                        ? f("연결됨 · 계좌 {0}", session.tossConnection.account || "")
                        : tr("연결 안 됨")}
                    </p>
                    {session.tossConnection?.ready ? (
                      <div className="login-actions">
                        <button className="primary" onClick={() => action(syncToss, { pending: tr("토스증권 자료를 가져오는 중입니다."), success: tr("투자 자산을 갱신했습니다.") })}>{tr("투자 자산 동기화")}</button>
                        <button
                          className="quiet"
                          onClick={() => action(async () => {
                            const tossConnection = await api("/toss/connection", undefined, "DELETE");
                            setSession((current) => ({ ...current, tossConnection }));
                            await refresh();
                          })}
                        >{tr("연결 정보 지우기")}</button>
                      </div>
                    ) : (
                      <>
                      <ol className="steps">
                        <li>{tr("PC에서 토스증권 웹에 로그인한 뒤 Open API 화면으로 갑니다.")} <a href="https://www.tossinvest.com/open-api/landing" target="_blank" rel="noreferrer">{tr("발급 화면 열기")}</a></li>
                        <li>{tr("오픈 API Key를 발급받고 Client ID와 Client Secret을 복사 버튼으로 복사합니다.")}</li>
                        <li>{tr("같은 화면 아래 허용 IP 관리에 이 PC의 공인 IP를 등록합니다. 등록하지 않은 IP에서는 조회와 주문이 모두 막힙니다.")}</li>
                        <li>{tr("복사한 두 값을 아래에 붙여 넣고 연결합니다.")}</li>
                      </ol>
                      <form onSubmit={connectToss} autoComplete="off">
                        <div className="form-grid">
                          <label>Client ID<input name="clientId" required minLength="8" maxLength="200" spellCheck="false" /></label>
                          <label>Client Secret<input name="clientSecret" type="password" required minLength="8" maxLength="500" /></label>
                        </div>
                        <button className="primary">{tr("토스증권 연결")}</button>
                      </form>
                      </>
                    )}
                    <p className="fine">{tr("이 키로는 주문도 할 수 있습니다. 알아서는 투자 탭에서 내가 누른 주문과 켜 둔 자동 투자의 주문만 보내고, 그 밖에는 조회만 합니다. 키는 이 기기의 암호화 저장소에만 둡니다.")}</p>
                  </section>
                  <section>
                    <h2>{tr("AI 연결")}</h2>
                    <p className="flow-note">{tr("거래나 소득이 바뀌면 이 연결로 자동 분류와 분석을 실행합니다. API 키는 메모리에만 두고 서버를 재시작하면 지웁니다.")}</p>
                    <form onSubmit={connect}>
                      <div className="form-grid">
                        <label>{tr("사용할 연결")}<select
                            name="provider"
                            value={connectionProvider}
                            onChange={(e) =>
                              setConnectionProvider(e.target.value)
                            }
                          >
                            <option value="codex">{tr("Codex / OpenCodex · ChatGPT 구독 로그인")}</option>
                            <option value="openai">{tr("OpenAI · API 키")}</option>
                            <option value="anthropic">{tr("Anthropic · API 키")}</option>
                          </select>
                        </label>
                        <label>{tr("사용할 AI")}<select
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
                                  {tr(model.label)}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>{tr("API 키")}<input
                            name="key"
                            type="password"
                            autoComplete="off"
                            maxLength="500"
                            placeholder={tr("구독 로그인은 입력 불필요")}
                          />
                        </label>
                      </div>
                      <button className="primary">{tr("이 연결 사용")}</button>
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
                      >{tr("API 키 지우기")}</button>
                    </form>
                    <p className="connection-status">
                      {f("지금은 {0} {1}을 쓰고 있습니다. {2}", session.connection.provider, session.connection.model || tr("기본 모델"), session.connection.hasKey ? tr("API 키 있음") : tr("API 키 없음"))}
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
                      >{tr("ChatGPT로 로그인")}</button>
                      <button
                        onClick={() =>
                          action(async () =>
                            setCodex(await api("/codex/status", {})),
                          )
                        }
                      >{tr("로그인 상태 확인")}</button>
                      <button
                        className="quiet"
                        onClick={() =>
                          action(async () =>
                            setCodex(await api("/codex/logout", {})),
                          )
                        }
                      >{tr("구독 로그아웃")}</button>
                    </div>
                    {login && (
                      <a
                        className="login-link"
                        href={login}
                        target="_blank"
                        rel="noreferrer"
                      >{tr("공식 로그인 페이지 열기 ↗")}</a>
                    )}
                    {codex && (
                      <p role="status">
                        {codex.connected
                          ? codex.route === "opencodex"
                            ? f("Codex 구독 연결됨 · OpenCodex {0} 경유", codex.opencodexVersion)
                            : tr("Codex 구독 연결됨 · 공식 Codex 경로")
                          : tr("구독 로그인 필요")}
                      </p>
                    )}
                      </>
                    )}
                    <p className="flow-note">{tr("Codex 로그인 정보는 이 프로젝트 안에만 저장됩니다. OpenCodex가 실행 중이면 자동으로 그쪽을 씁니다.")}</p>
                  </section>
                  <section>
                    <h2>{tr("거래 불러오기")}</h2>
                    <p className="flow-note">{tr("거래 JSON이나 CODEF 승인내역 파일을 올리면 분석에 씁니다.")}</p>
                    <label className="file-input">{tr("거래 JSON / CODEF 승인내역 가져오기")}<input
                        type="file"
                        accept=".json,application/json"
                        onChange={(e) =>
                          action(async () => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2000000)
                              throw Error(tr("2MB 이하 파일을 선택하세요."));
                            let parsed;
                            try {
                              parsed = JSON.parse(await file.text());
                            } catch {
                              throw Error(
                                tr("JSON 파일이 아니거나 내용이 손상됐습니다. 내려받은 파일을 그대로 올려주세요."),
                              );
                            }
                            await api("/import", parsed);
                            e.target.value = "";
                            await refresh();
                          })
                        }
                      />
                    </label>
                    <details className="format-help">
                      <summary>{tr("지원 형식")}</summary>
                      <p className="fine">{tr("일반 거래 파일: transactions, from, to, complete, source. CODEF 응답은 전체 수집 여부를 미확인으로 저장합니다. 같은 source·id를 다시 가져오면 갱신합니다.")}</p>
                    </details>
                    <h3>{tr("최근 가져오기")}</h3>
                    {state.coverage.map((c, i) => (
                      <p className="fine" key={i}>
                        {c.from} ~ {c.to} · {c.source} ·{" "}
                        {c.complete ? tr("전체 기간 확인") : tr("일부 자료")}
                      </p>
                    ))}
                  </section>
                  <AutoSyncSettings action={action} session={session} />
                  <NotificationSettings action={action} />
                  <section>
                    <h2>{tr("MCP 연결")}</h2>
                    <p className="flow-note">{tr("설정을 복사해 MCP를 지원하는 AI 앱에 등록하면 같은 자료를 쓸 수 있습니다.")}</p>
                    <button
                      onClick={() =>
                        action(async () => {
                          const text = JSON.stringify(await api("/mcp-config"), null, 2);
                          setMcpConfig(text);
                          // The clipboard is blocked when the window is not focused; the text below is the fallback.
                          try {
                            await navigator.clipboard.writeText(text);
                            setMcpStatus(tr("MCP 설정을 복사했습니다."));
                          } catch {
                            setMcpStatus(tr("복사가 막혀 있어 아래 내용을 직접 복사하세요."));
                          }
                        })
                      }
                    >{tr("MCP 연결 설정 복사")}</button>
                    <p role="status" className="fine">
                      {mcpStatus}
                    </p>
                    {mcpConfig && (
                      <textarea
                        className="mcp-config"
                        readOnly
                        rows="10"
                        value={mcpConfig}
                        aria-label={tr("MCP 연결 설정")}
                        onFocus={(e) => e.target.select()}
                      />
                    )}
                    <p className="flow-note">{tr("별도 키는 필요 없고, 연결한 앱의 구독과 정책을 따릅니다.")}</p>
                  </section>
                  <section>
                    <h2>{tr("최근 반영 기록")}</h2>
                    {state.events.map((e, i) => (
                      <p className="event" key={i}>
                        <time>{dateTime(e.at)}</time>
                        {tr(e.action)}
                      </p>
                    ))}
                  </section>
                </div>
              )}
            </>
          )}
        </main>
        <footer>{tr("이 기기에서만 동작하는 개인용 도구입니다. 결제나 이체는 하지 않습니다.")}</footer>
      </div>
      <dialog id="transaction-detail" onClose={() => setDetail(null)}>
        {detail && (
          <>
            <form method="dialog">
              <button className="close">{tr("닫기")}</button>
            </form>
            <p className="eyebrow">{tr("거래 판정 근거")}</p>
            <h2>{detail.merchant}</h2>
            <p className="lead-amount">{won(detail.amount)}</p>
            <p>
              {detail.date} · {tr(labels[detail.status])}
            </p>
            <p className="evidence">
              {detail.evidence || tr("추가 판정 근거 없음")}
            </p>
            <p className="fine">
              {f("출처: {0}", detail.source)}
              {detail.duplicate
                ? f(" · {0}에 같은 거래가 있어 합계에서 제외했습니다.", detail.duplicate)
                : ""}
            </p>
            {detail.aiCategory && (
              <p className="fine">{f("AI 분류 근거: {0}", detail.aiCategory.reason)}</p>
            )}
            {(() => {
              const same = state.transactions.filter(
                (t) => t.merchant === detail.merchant && !t.duplicate,
              );
              return (
                <label className="bulk-category">
                  {f("이 이용처 {0}건을 한 번에", same.length)}
                  <select
                    value={detail.category}
                    onChange={(e) =>
                      action(async () => {
                        await tool("categorize_transactions", {
                          merchant: detail.merchant,
                          category: e.target.value,
                        });
                        setDetail(null);
                        document.querySelector("#transaction-detail")?.close();
                      })
                    }
                  >
                    {Object.entries(cats).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })()}
            <button
              onClick={() =>
                action(() =>
                  tool("confirm_recurring", {
                    merchant: detail.merchant,
                    confirmed: true,
                  }),
                )
              }
            >{tr("이 이용처를 고정비로 지정")}</button>
          </>
        )}
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
