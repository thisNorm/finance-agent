import { z } from "zod";
import { createVault } from "./codef-bank.js";

// Toss Securities Open API. The key can trade (there is no read-only scope), so reads go through
// an allowlist of lookups and the only write is placeOrder(), which takes a strictly shaped order.
const HOST = "https://openapi.tossinvest.com";
const READ_PATHS = [
  /^\/api\/v1\/(accounts|holdings|buying-power|orders|prices|candles|stocks|exchange-rate)$/,
  /^\/api\/v1\/market-calendar\/(KR|US)$/,
  /^\/api\/v1\/orders\/[A-Za-z0-9_-]{8,200}$/,
];
const NO_ACCOUNT = /^\/api\/v1\/(accounts|prices|candles|stocks|exchange-rate|market-calendar\/(KR|US))$/;
export const orderSchema = z
  .object({
    clientOrderId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
    symbol: z.string().regex(/^[A-Z0-9.-]{1,12}$/),
    side: z.enum(["BUY", "SELL"]),
    orderType: z.literal("MARKET"),
    quantity: z.string().regex(/^[1-9][0-9]{0,6}$/),
  })
  .strict();

export const tossConnectionSchema = z
  .object({
    clientId: z.string().trim().min(8).max(200),
    clientSecret: z.string().trim().min(8).max(500),
  })
  .strict();

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const krw = (v) => Math.round(num(v));
const mask = (no) => {
  const s = String(no || "");
  return s.length > 4 ? "•••• " + s.slice(-4) : s;
};

export function normalizeHoldings(overview = {}, cash = {}) {
  const items = (overview.items || []).map((i) => ({
    symbol: String(i.symbol || ""),
    name: String(i.name || i.symbol || ""),
    market: i.marketCountry === "US" ? "US" : "KR",
    currency: i.currency === "USD" ? "USD" : "KRW",
    quantity: num(i.quantity),
    lastPrice: num(i.lastPrice),
    averagePrice: num(i.averagePurchasePrice),
    value: num(i.marketValue?.amount),
    profit: num(i.profitLoss?.amount),
    profitRate: num(i.profitLoss?.rate),
    dailyRate: num(i.dailyProfitLoss?.rate),
  }));
  return {
    items: items.sort((a, b) => b.value - a.value),
    value: { krw: krw(overview.marketValue?.amount?.krw), usd: num(overview.marketValue?.amount?.usd) },
    invested: { krw: krw(overview.totalPurchaseAmount?.krw), usd: num(overview.totalPurchaseAmount?.usd) },
    profit: { krw: krw(overview.profitLoss?.amount?.krw), usd: num(overview.profitLoss?.amount?.usd) },
    profitRate: num(overview.profitLoss?.rate),
    dailyRate: num(overview.dailyProfitLoss?.rate),
    cash: { krw: krw(cash.KRW), usd: num(cash.USD) },
  };
}

export function createToss({ fetcher = fetch, vaultPath = null } = {}) {
  const vault = createVault(vaultPath);
  const status = () => {
    const c = vault.read();
    return {
      ready: !!(c?.clientId && c?.clientSecret),
      clientId: c?.clientId ? c.clientId.slice(0, 4) + "••••" : null,
      account: c?.accountNo ? mask(c.accountNo) : null,
    };
  };
  const fail = (res, body) => {
    const code = body?.error?.code || body?.error || "";
    if (res.status === 401 || code === "invalid_client")
      throw Error("토스증권 키를 확인하세요. 토스증권 웹의 Open API 화면에서 복사 버튼으로 복사한 값을 그대로 넣어야 합니다.");
    if (res.status === 403) throw Error("토스증권이 요청을 막았습니다. 토스증권 웹 Open API 화면의 허용 IP 관리에 이 PC의 공인 IP를 등록하세요.");
    if (res.status === 429) throw Error("토스증권 호출 한도에 걸렸습니다. 잠시 후 다시 시도하세요.");
    throw Error("토스증권에서 자료를 받지 못했습니다. 잠시 후 다시 시도하세요.");
  };
  // One live token per client: issuing a new one revokes the old, so keep it until it expires.
  async function token(c, fresh = false) {
    if (!fresh && c.token && c.tokenExpiresAt > Date.now() + 60_000) return c.token;
    const res = await fetcher(HOST + "/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) fail(res, body);
    c.token = body.access_token;
    c.tokenExpiresAt = Date.now() + num(body.expires_in) * 1000;
    vault.write(c);
    return c.token;
  }
  async function get(c, path, query = {}, account = !NO_ACCOUNT.test(path)) {
    if (!READ_PATHS.some((p) => p.test(path))) throw Error("토스증권 조회만 할 수 있습니다.");
    const url = HOST + path + (Object.keys(query).length ? "?" + new URLSearchParams(query) : "");
    for (const fresh of [false, true]) {
      const res = await fetcher(url, {
        method: "GET",
        headers: {
          authorization: "Bearer " + (await token(c, fresh)),
          ...(account ? { "x-tossinvest-account": String(c.accountSeq) } : {}),
        },
      });
      const body = await res.json().catch(() => null);
      if (res.ok) return body?.result;
      // someone else issued a token for this key: get a new one once
      if (res.status === 401 && !fresh) continue;
      fail(res, body);
    }
  }
  async function pickAccount(c) {
    const accounts = (await get(c, "/api/v1/accounts", {}, false)) || [];
    const a = accounts.find((x) => x.accountType === "BROKERAGE") || accounts[0];
    if (!a) throw Error("토스증권 계좌를 찾지 못했습니다.");
    c.accountSeq = a.accountSeq;
    c.accountNo = String(a.accountNo || "");
    vault.write(c);
  }
  const ready = async () => {
    const c = vault.read();
    if (!c?.clientId) throw Error("토스증권을 먼저 연결하세요.");
    if (!c.accountSeq) await pickAccount(c);
    return c;
  };
  return {
    status,
    // read-only lookups used by the investing module
    read: async (path, query = {}) => get(await ready(), path, query),
    // the one write. Only whole-share market orders with an idempotency key get through.
    async placeOrder(input) {
      const order = orderSchema.parse(input),
        c = await ready();
      for (const fresh of [false, true]) {
        const res = await fetcher(HOST + "/api/v1/orders", {
          method: "POST",
          headers: {
            authorization: "Bearer " + (await token(c, fresh)),
            "x-tossinvest-account": String(c.accountSeq),
            "content-type": "application/json",
          },
          body: JSON.stringify(order),
        });
        const body = await res.json().catch(() => null);
        if (res.ok) return body?.result;
        if (res.status === 401 && !fresh) continue;
        if (res.status === 422 || res.status === 400)
          throw Error("토스증권이 주문을 받지 않았습니다. 장 운영 시간·매수 가능 금액·종목 상태를 확인하세요.");
        fail(res, body);
      }
    },
    async configure(input) {
      const { clientId, clientSecret } = tossConnectionSchema.parse(input);
      const previous = vault.read(),
        c = { clientId, clientSecret };
      try {
        await pickAccount(c); // proves the key works; a failed try must not replace a working one
      } catch (e) {
        previous ? vault.write(previous) : vault.clear();
        throw e;
      }
      return status();
    },
    clear() {
      vault.clear();
      return status();
    },
    async sync() {
      const c = await ready();
      const holdings = await get(c, "/api/v1/holdings");
      const cash = { KRW: (await get(c, "/api/v1/buying-power", { currency: "KRW" }))?.cashBuyingPower };
      // dollar cash is optional: an account without US trading must still sync
      cash.USD = await get(c, "/api/v1/buying-power", { currency: "USD" }).then((r) => r?.cashBuyingPower, () => 0);
      return { at: new Date().toISOString(), account: mask(c.accountNo), ...normalizeHoldings(holdings, cash) };
    },
  };
}
