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
    // cancellations being followed until they're done: key → when asked, how, and the charge it must beat
    cancels: z
      .record(
        z.string(),
        z
          .object({
            at: z.string(),
            method: z.enum(["self", "mail", "unknown"]).default("unknown"),
            mailTo: z.string().default(""),
            sentAt: z.string().default(""),
            deadline: z.string().default(""),
            doneAt: z.string().default(""),
            notified: z.record(z.string(), z.string()).default({}),
          })
          .strict(),
      )
      .default({}),
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

// ---- finding the recurring streams inside a payee's charges ----
// Payment gateways put their own name first: "KCP - 쿠팡", "(주)이니시스 - (주)와우바이오텍". The shop is after the dash.
const GATEWAY = /^\s*(?:\(주\)|㈜)?\s*(?:NHN\s*)?(?:KCP|KG\s*이니시스|이니시스|토스페이먼츠(?:주식회사)?|나이스(?:페이먼츠)?|NICE|한국정보통신|KICC|웰컴페이먼츠|다날|KSNET|스마트로|카카오페이|카카오|네이버페이|페이코|헥토파이낸셜|세틀뱅크|키움페이|페이레터)\s*-\s*/i;
export const payeeName = (merchant) => {
  const rest = merchant.replace(GATEWAY, "");
  return (rest === merchant ? merchant : rest).replace(/^\s*(?:\(주\)|㈜|주식회사)\s*|\s*(?:\(주\)|주식회사)\s*$/g, "").trim() || merchant;
};
// Who is really being paid, whatever the issuer calls it this month: "토스페이먼츠주식회사 - (주)비바리퍼블리" and
// "Apple - (주)비바리퍼블리카", "#LG유플러스통신요 -**64-2557" and "LG유플러스통신요금" are the same payee
// (gateways go first, names get cut at 20 characters, card sites spell them differently).
export const payeeCore = (merchant) =>
  (merchant.includes(" - ") ? merchant.split(" - ").at(-1) : merchant)
    .replace(/\(주\)|㈜|주식회사/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "")
    .slice(0, 6) || merchant;
// card times come as HHMM, bank times as HHMMSS
const minutes = (t) => (t && /^\d{4}(\d{2})?$/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(2, 4) : null);
const clockGap = (a, b) => {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
};
const lastDay = (date) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate();
const dayOf = (date) => +date.slice(8, 10);
const near = (a, b, ratio) => Math.max(a, b) <= Math.min(a, b) * ratio;
// circular median of clock times, so 23:50 and 00:10 average to midnight, not noon
function usualMinute(times) {
  const m = times.map(minutes).filter((x) => x != null);
  if (!m.length) return null;
  return m.reduce((best, c) => (m.reduce((s, x) => s + clockGap(x, c), 0) < m.reduce((s, x) => s + clockGap(x, best), 0) ? c : best), m[0]);
}
const hhmm = (m) => (m == null ? null : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
// The day of the month a plan bills on: a 31st plan shows up on the 30th in September, so month-ends count as "31".
function anchorDay(dates) {
  const d = dates.slice(-3).map((x) => (dayOf(x) === lastDay(x) && dayOf(x) >= 28 ? 31 : dayOf(x)));
  return median(d);
}
// next date on that day of the month after `after`, clamped to shorter months
function nextOnDay(after, day, stepMonths = 1) {
  const y = +after.slice(0, 4),
    m = +after.slice(5, 7) - 1;
  // most of a cycle after the last charge: a charge a day early doesn't make "next" land next week (or 11 months on)
  const least = { 1: 20, 3: 70, 12: 340 }[stepMonths] ?? stepMonths * 28;
  for (let k = Math.max(0, stepMonths - 1); k <= stepMonths + 1; k++) {
    const first = new Date(Date.UTC(y, m + k, 1)),
      end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate(),
      date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, end))).toISOString().slice(0, 10);
    if (date > after && days(after, date) >= least) return date;
  }
  return addMonths(after, stepMonths);
}
/**
 * Splits one payee's charges into recurring streams. A stream keeps the same rhythm and either the same clock
 * time (billing systems charge at the same minute every cycle) or the same amount. A payee can carry several:
 * Kakao billing ₩990 on the 1st and ₩3,900 on the 26th are two subscriptions, not one noisy one.
 * `variable` allows the amount to move (a utility's auto-debit).
 */
// At least four charges at the same clock time (±30 min), 10–120 days apart: a billing system, not a person.
function automaticIn(charges) {
  const timed = charges.filter((c) => minutes(c.time) != null),
    mid = usualMinute(timed.map((c) => c.time));
  if (mid == null) return null;
  const onTime = timed.filter((c) => clockGap(minutes(c.time), mid) <= 30),
    gaps = onTime.slice(1).map((c, i) => days(onTime[i].date, c.date));
  if (onTime.length < 4 || onTime.length < timed.length * 0.6 || !gaps.every((g) => g >= 10 && g <= 120)) return null;
  const every = median(gaps);
  return { cycle: cycleOf(every) || "days", every, charges: onTime, automatic: true, regular: gaps.every((g) => cycleOf(g) && cycleOf(g) === cycleOf(gaps[0])) };
}
export function streamsOf(charges, { foreign = false, variable = false } = {}) {
  // same minute every time but no calendar rhythm (a delivery every 5–8 weeks): one automatic stream, taken first so
  // its charges aren't cut into look-alike quarterly pieces
  const auto = automaticIn(charges);
  const first = auto && !auto.regular ? [{ ...auto, cycle: "days" }] : [],
    left = first.length ? charges.filter((c) => !first[0].charges.includes(c)) : charges;
  const chains = [];
  for (const c of left) {
    let best = null,
      bestScore = Infinity;
    for (const ch of chains) {
      const last = ch.items.at(-1),
        gap = days(last.date, c.date),
        rhythm = cycleOf(gap);
      if (!rhythm || (ch.cycle && ch.cycle !== rhythm)) continue;
      const t1 = minutes(last.time),
        t2 = minutes(c.time),
        sameTime = t1 != null && t2 != null && clockGap(t1, t2) <= 90,
        sameAmount = near(last.amount, c.amount, foreign ? 1.25 : 1.1),
        // monthly, quarterly and yearly plans bill on the same day of the month (±3, month-ends together)
        sameDay = rhythm === "week" || Math.abs(dayOf(c.date) - anchorDay(ch.items.map((x) => x.date))) <= 3 || (dayOf(c.date) >= 28 && anchorDay(ch.items.map((x) => x.date)) >= 28);
      const timeKnown = t1 != null && t2 != null;
      if (!sameDay) continue;
      // another hour and another amount: another payment (a biller moving its run from 03:40 to 00:27 keeps the amount)
      if (timeKnown && !sameTime && !sameAmount && !variable) continue;
      // a new amount can only continue a stream already two long (a price rise), never start one
      if (!sameTime && !sameAmount && !variable && ch.items.length < 2) continue;
      const score = (sameTime ? clockGap(t1, t2) : 100) + (sameAmount ? 0 : 200);
      if (score < bestScore) (best = ch), (bestScore = score);
    }
    if (best) {
      best.cycle ||= cycleOf(days(best.items.at(-1).date, c.date));
      best.items.push(c);
    } else chains.push({ cycle: null, items: [c] });
  }
  // quarterly needs three charges (two could be anything); a year needs the same amount twice
  const streams = chains
    .filter((ch) => ch.cycle && (ch.items.length >= 3 || (ch.cycle === "year" && ch.items.length >= 2 && near(ch.items[0].amount, ch.items[1].amount, foreign ? 1.25 : 1.05))))
    .map((ch) => ({ cycle: ch.cycle, charges: ch.items }));
  if (first.length) return [...first, ...streams];
  // what the chains left over may still be automatic
  const taken = new Set(streams.flatMap((st) => st.charges)),
    later = automaticIn(charges.filter((c) => !taken.has(c)));
  if (later) streams.push({ ...later, cycle: later.regular ? later.cycle : "days" });
  return streams;
}
// When the next charge comes, from the stream's own rhythm (not just "last + a month", which drifts)
export function nextCharge(stream) {
  const dates = stream.charges.map((c) => c.date),
    last = dates.at(-1);
  if (stream.cycle === "days") return addDays(last, stream.every);
  if (stream.cycle === "week") return addDays(last, 7);
  const day = anchorDay(dates);
  return nextOnDay(last, day, stream.cycle === "quarter" ? 3 : stream.cycle === "year" ? 12 : 1);
}
export { hhmm, usualMinute };

// One charge per day per payee: the same payment seen twice (two sources, a re-quoted FX amount) counts once.
function chargesOf(rows, foreign = false) {
  // two different payments to one payee on one day (Toss, Kakao) stay two; the same payment seen twice is one
  const seen = new Map();
  for (const t of rows) {
    const k = foreign ? t.date : `${t.date}:${Math.round(t.amount / 10)}`,
      had = seen.get(k);
    if (!had) seen.set(k, { date: t.date, amount: t.amount, time: t.time });
    else if (!had.time && t.time) had.time = t.time;
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
}

// Service identity across card merchants and mail senders: "ANTHROPIC* CLAUDE SUB" and a Claude receipt are one.
const canonical = (name) => ((known(name || "")?.[1] || name || "").toLowerCase().replace(/[\s·.+]/g, ""));

export function findSubscriptions(state, today, settings = subscriptionSettingsSchema.parse({}), mail = null) {
  const s = subscriptionSettingsSchema.parse(settings);
  const groups = new Map();
  for (const t of [...(state.transactions || [])].sort((a, b) => a.date.localeCompare(b.date)))
    // rows marked as another source's duplicate stay in: chargesOf() folds them into one charge and keeps
    // whichever copy knows the time (the card site's copy doesn't, CODEF's does)
    if (!["cancelled", "rejected"].includes(t.status)) {
      const id = "card:" + payeeCore(t.merchant),
        g = groups.get(id) || groups.set(id, { source: "card", merchants: new Set(), rows: [] }).get(id);
      // the latest spelling and category are the ones shown
      g.merchant = t.merchant;
      g.category = t.category;
      g.merchants.add(t.merchant);
      g.rows.push(t);
    }
  // bank: only standing orders (CMS, auto-debit), never ordinary transfers such as rent to a person
  for (const t of state.bankTransactions || [])
    if (t.direction === "out" && /CMS|자동이체|정기|구독/i.test(t.description || "")) {
      const key = "bank:" + t.description;
      (groups.get(key) || groups.set(key, { source: "bank", merchant: t.description, merchants: new Set([t.description]), category: "", rows: [] }).get(key)).rows.push(t);
    }
  const items = [];
  for (const g of groups.values()) {
    // keyed by the latest spelling; a decision made under an older one still counts
    const key = (g.source === "bank" ? "bank:" : "card:") + g.merchant,
      older = [...g.merchants].map((m) => (g.source === "bank" ? "bank:" : "card:") + m),
      service = known(g.merchant) || [...g.merchants].map(known).find(Boolean),
      foreign = foreignName(g.merchant) || g.rows.some((t) => t.overseas),
      // an auto-debit's amount moves month to month (gas, electricity) and it is still one plan
      variable = g.source === "bank" || /자동이체|자동납부|CMS/i.test(g.merchant),
      charges = chargesOf(g.rows, foreign);
    if (!charges.length) continue;
    // a payee is "everyday" (taxi, restaurant) by most of its charges, not by whatever the last one was filed as
    const cats = g.rows.reduce((m, t) => m.set(t.category, (m.get(t.category) || 0) + 1), new Map()),
      mostly = [...cats].sort((a, b) => b[1] - a[1])[0]?.[0];
    let streams = (EVERYDAY.has(mostly) || EVERYDAY.has(g.category)) && !service ? [] : streamsOf(charges, { foreign, variable });
    // weekly repeats are mostly habits; only a known subscription billing weekly counts
    streams = streams.filter((st) => st.cycle !== "week" || g.category === "subscription");
    const single = streams.length <= 1,
      remembered = g.source === "card" && [...g.merchants].some((m) => state.recurring?.[m] === true),
      earlier = (k) => s.decisions[k] ?? (k === key ? older.map((o) => s.decisions[o]).find((d) => d !== undefined) : undefined);
    if (!streams.length) {
      // no stream yet: a known service, one the AI filed as a subscription, or one the user already confirmed
      if (!(service || g.category === "subscription" || earlier(key) === true || remembered)) continue;
      const gaps = charges.slice(1).map((c, i) => days(charges[i].date, c.date));
      streams = [{ cycle: gaps.length ? cycleOf(median(gaps)) : null, charges, loose: true }];
    }
    for (const st of streams) {
      const ch = st.charges,
        slot = st.cycle === "month" ? anchorDay(ch.map((c) => c.date)) + "일" : st.automatic ? "auto" : st.cycle || "one",
        k = single ? key : `${key}@${slot}`,
        decision = earlier(k) ?? (single && remembered ? true : undefined);
      if (decision === false) continue;
      const last = ch.at(-1),
        prev = ch.at(-2),
        amounts = ch.map((c) => c.amount),
        c = s.overrides[k]?.cycle || (st.cycle === "days" ? "days" : st.cycle) || "month",
        every = c === "days" ? st.every : null,
        next = s.overrides[k]?.cycle ? nextFrom(last.date, c) : st.cycle ? nextCharge(st) : nextFrom(last.date, "month"),
        usual = usualMinute(ch.map((x) => x.time)),
        flags = [];
      if (prev && !foreign && !variable && last.amount !== prev.amount) flags.push(last.amount > prev.amount ? "price-up" : "price-down");
      if (foreign && new Set(amounts).size > 1) flags.push("fx");
      if (variable && new Set(amounts).size > 1) flags.push("varies");
      if (st.automatic) flags.push("automatic");
      // around midnight the calendar day can flip between cycles (23:50 one month, 00:10 the next)
      if (usual != null && (usual >= 22 * 60 + 30 || usual <= 90)) flags.push("near-midnight");
      if (c === "month" && ch.filter((x) => x.date.slice(0, 7) === last.date.slice(0, 7)).length > 1) flags.push("double");
      // "stopped" needs a known rhythm: one charge alone says nothing about when the next is due
      const late = days(next, today),
        span = every || CYCLES[c] || 30;
      if (!s.overrides[k]?.cycle && !st.cycle && ch.length < 2) flags.push("cycle-unknown");
      else if (late > 10) flags.push("stopped");
      else if (late > 0) flags.push("overdue");
      // silent for more than a whole cycle and never confirmed: a plan that ended, not one to review
      if (decision !== true && (late > span || (!st.cycle && days(last.date, today) > 45))) continue;
      items.push({
        key: k,
        source: g.source,
        merchant: g.merchant,
        name: s.overrides[k]?.name || service?.[1] || payeeName(g.merchant),
        category: g.category,
        amount: last.amount,
        cycle: c,
        every,
        cycleGuessed: !st.cycle,
        lastDate: last.date,
        nextDate: next,
        usualTime: hhmm(usual),
        charges: ch.slice(-6).map(({ date, amount, time }) => ({ date, amount, ...(time ? { time } : {}) })),
        monthly: Math.round(every ? (last.amount * CYCLES.month) / every : (last.amount * CYCLES.month) / CYCLES[c]),
        flags,
        confirmed: decision === true,
        // splitting a payee into streams means its other payments aren't this subscription, so it can't be a whole-payee fixed cost
        shared: !single,
        remind: s.overrides[k]?.remind ?? c !== "month",
        manageUrl: s.overrides[k]?.manageUrl || service?.[2] || "",
        previous: prev?.amount ?? null,
      });
    }
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
      // the service's own word on the next charge beats a date worked out from past charges
      if (m.nextDate && m.nextDate >= today && days(today, m.nextDate) <= 400 && !s.overrides[hit.key]?.cycle) {
        hit.nextDate = m.nextDate;
        hit.flags = hit.flags.filter((f) => f !== "stopped");
        hit.flags.push("date-from-mail");
      }
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
      next = m.nextDate && m.nextDate >= today ? m.nextDate : last ? nextFrom(last.date, c) : m.lastDate,
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
  // ---- cancellations in progress: done when the service confirms by mail, when the charge date passes with no
  // charge, or when the user says so; a charge after the request is the thing to shout about ----
  for (const i of items) {
    const c = s.cancels[i.key];
    if (!c) continue;
    const since = c.at.slice(0, 10),
      charged = i.charges.find((x) => x.date > since) || (i.mail?.lastDate && i.source === "mail" && i.lastDate > since ? { date: i.lastDate } : null),
      byMail = i.mail?.cancelDate && i.mail.cancelDate >= since,
      // only a stream the card or bank can see proves anything by staying silent
      silent = i.source !== "manual" && c.deadline && days(c.deadline, today) > 3,
      state = charged ? "charged" : c.doneAt || byMail || silent ? "done" : c.deadline && c.deadline < today && i.source === "manual" ? "check" : "pending";
    i.cancel = { since, method: c.method, mailTo: c.mailTo, sentAt: c.sentAt, deadline: c.deadline, state, chargedOn: charged?.date || null, by: charged ? null : c.doneAt ? "user" : byMail ? "mail" : silent ? "no-charge" : null };
    // a cancelled plan going quiet is the point, not an alert
    if (state === "done") i.flags = i.flags.filter((f) => !["stopped", "overdue"].includes(f));
    i.flags.push({ charged: "cancel-charged", done: "cancel-done", check: "cancel-check", pending: "cancelling" }[state]);
  }
  items.sort((a, b) => (b.confirmed - a.confirmed) || a.nextDate.localeCompare(b.nextDate));
  const counted = items.filter((i) => i.confirmed && !i.flags.includes("stopped") && !i.flags.includes("cancel-done"));
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

// The charge a cancellation has to beat: the next one still to come. A due date already past (a late charge, or one
// that was never going to come) would make "no charge by then" prove nothing, so it rolls on a cycle.
export function cancelDeadline(item, today) {
  let d = item.nextDate;
  for (let k = 0; d && d < today && k < 24; k++) d = item.cycle === "days" && item.every ? addDays(d, item.every) : nextFrom(d, item.cycle || "month");
  return d || "";
}

// Reminders due today: a few days before each subscription whose reminder is on, once per charge date.
export function dueReminders(found, today, reminded = {}, lead = 3) {
  return found.items.filter(
    (i) => i.confirmed && i.remind && !i.flags.includes("stopped") && days(today, i.nextDate) >= 0 && days(today, i.nextDate) <= lead && reminded[i.key] !== i.nextDate,
  );
}
