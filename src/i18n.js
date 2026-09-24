// Korean is the source language: every key here is the Korean string as written in the UI,
// so an untranslated string still renders (in Korean) instead of breaking.
import en from "./i18n-en.js";

const STORE_KEY = "alaseo-lang";
const read = () => {
  try {
    return localStorage.getItem(STORE_KEY) === "en" ? "en" : "ko";
  } catch {
    return "ko";
  }
};
let lang = read();
const listeners = new Set();

export const getLang = () => lang;
export const onLangChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export function setLang(next) {
  lang = next === "en" ? "en" : "ko";
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    /* private mode: the choice just does not survive a reload */
  }
  document.documentElement.lang = lang === "en" ? "en" : "ko";
  listeners.forEach((fn) => fn(lang));
}
export const t = (korean) => (lang === "en" ? en[korean] ?? korean : korean);
// f("남은 {0}건", 3) — the key keeps its placeholders so the English word order can differ.
export const f = (korean, ...args) =>
  t(korean).replace(/\{(\d)\}/g, (_, i) => (args[i] === undefined ? "" : args[i]));
export const locale = () => (lang === "en" ? "en-US" : "ko-KR");
// 12,000원 / ₩12,000 — the app only ever deals in KRW.
export const money = (n) =>
  lang === "en"
    ? "₩" + new Intl.NumberFormat("en-US").format(n)
    : new Intl.NumberFormat("ko-KR").format(n) + "원";
export const dateTime = (value) =>
  new Date(value).toLocaleString(locale(), lang === "en" ? { dateStyle: "medium", timeStyle: "short" } : undefined);
// "3개월" / "3 months", "5일" / "the 5th"
export const months = (n) => (lang === "en" ? `${n} month${n > 1 ? "s" : ""}` : `${n}개월`);
export const dayOfMonth = (n) =>
  lang === "en" ? `the ${n}${["th", "st", "nd", "rd"][n % 10 > 3 || (n > 10 && n < 20) ? 0 : n % 10]}` : `${n}일`;
document.documentElement.lang = lang === "en" ? "en" : "ko";
