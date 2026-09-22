import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

export const bankOptions = [
  ["0002", "산업은행"],
  ["0003", "기업은행"],
  ["0004", "국민은행"],
  ["0007", "수협은행"],
  ["0011", "농협은행"],
  ["0020", "우리은행"],
  ["0023", "SC은행"],
  ["0027", "씨티은행"],
  ["0031", "대구은행"],
  ["0032", "부산은행"],
  ["0034", "광주은행"],
  ["0035", "제주은행"],
  ["0037", "전북은행"],
  ["0039", "경남은행"],
  ["0045", "새마을금고"],
  ["0048", "신협은행"],
  ["0071", "우체국"],
  ["0081", "KEB하나은행"],
  ["0088", "신한은행"],
  ["0089", "K뱅크"],
].map(([value, label]) => ({ value, label }));
export const cardOptions = [
  ["0301", "KB카드"],
  ["0302", "현대카드"],
  ["0303", "삼성카드"],
  ["0304", "NH카드"],
  ["0305", "BC카드"],
  ["0306", "신한카드"],
  ["0307", "씨티카드"],
  ["0309", "우리카드"],
  ["0311", "롯데카드"],
  ["0313", "하나카드"],
  ["0315", "전북카드"],
  ["0316", "광주카드"],
  ["0320", "수협카드"],
  ["0321", "제주카드"],
].map(([value, label]) => ({ value, label }));

const organization = z.enum(bankOptions.map(({ value }) => value));
const cardOrganization = z.enum(cardOptions.map(({ value }) => value));
export const bankConnectionSchema = z
  .object({
    environment: z.enum(["demo", "production"]),
    clientId: z.string().trim().min(8).max(300),
    clientSecret: z.string().trim().min(8).max(500),
    publicKey: z.string().trim().min(100).max(2000),
    connectedId: z.union([z.literal(""), z.string().trim().min(8).max(300)]),
    organizations: z.array(organization).max(bankOptions.length).default([]),
    birthDate: z.union([z.literal(""), z.string().regex(/^\d{8}$/)]).default(""),
  })
  .strict();

const birthDate = z.union([
  z.literal(""),
  z.string().regex(/^\d{6}(?:\d{2})?$/),
]);
export const cardRegistrationSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("id"),
      organization: cardOrganization,
      loginId: z.string().trim().min(1).max(200),
      loginPassword: z.string().min(1).max(200),
      cardNo: z.preprocess(
        (value) => String(value ?? "").replace(/\D/g, ""),
        z.string().max(19),
      ),
      cardPassword: z.union([z.literal(""), z.string().regex(/^\d{2,4}$/)]),
      birthDate,
    })
    .strict(),
  z
    .object({
      method: z.literal("certificate"),
      organization: cardOrganization,
      certType: z.enum(["1", "pfx"]),
      derFile: z.string().max(700_000).default(""),
      keyFile: z.string().max(700_000).default(""),
      certFile: z.string().max(700_000).default(""),
      certificatePassword: z.string().min(1).max(200),
      birthDate,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.certType === "pfx" ? !value.certFile : !value.derFile || !value.keyFile)
        ctx.addIssue({ code: "custom", message: "인증서 파일을 확인하세요." });
    }),
]).superRefine((value, ctx) => {
  if (
    value.method === "id" &&
    value.organization === "0302" &&
    (!/^\d{12,19}$/.test(value.cardNo) || !/^\d{4}$/.test(value.cardPassword))
  )
    ctx.addIssue({
      code: "custom",
      message: "현대카드는 카드번호와 카드 비밀번호 4자리가 필요합니다.",
    });
  if (
    value.method === "id" &&
    value.organization === "0301" &&
    (!!value.cardNo !== !!value.cardPassword ||
      (value.cardPassword && !/^\d{2}$/.test(value.cardPassword)))
  )
    ctx.addIssue({
      code: "custom",
      message: "KB카드 소지 확인 정보는 카드번호와 비밀번호 앞 2자리를 함께 입력하세요.",
    });
});
export const bankRegistrationSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("id"),
      organization,
      loginId: z.string().trim().min(1).max(200),
      loginPassword: z.string().min(1).max(200),
      birthDate,
    })
    .strict(),
  z
    .object({
      method: z.literal("certificate"),
      organization,
      certType: z.enum(["1", "pfx"]),
      derFile: z.string().max(700_000).default(""),
      keyFile: z.string().max(700_000).default(""),
      certFile: z.string().max(700_000).default(""),
      certificatePassword: z.string().min(1).max(200),
      birthDate,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.certType === "pfx" ? !value.certFile : !value.derFile || !value.keyFile)
        ctx.addIssue({ code: "custom", message: "인증서 파일을 확인하세요." });
    }),
]);

export const quickRegistrationSchema = z
  .object({
    organization,
    credentialType: z.enum(["account", "fast", "id"]),
    alias: z.string().trim().max(40).default(""),
    id: z.string().trim().max(200).default(""),
    password: z.string().max(200).default(""),
    fastId: z.string().trim().max(200).default(""),
    fastPassword: z.string().max(200).default(""),
    account: z.preprocess(
      (value) => String(value ?? "").replace(/\D/g, ""),
      z.string().max(40),
    ),
    accountPassword: z.string().max(200).default(""),
    identity: z.union([z.literal(""), z.string().regex(/^\d{6}$/)]).default(""),
  })
  .strict()
  .superRefine((value, ctx) => {
    const complete =
      value.credentialType === "id"
        ? value.account && value.accountPassword && value.id && value.password
        : value.credentialType === "fast"
          ? value.fastId && value.fastPassword
          : value.account && value.accountPassword;
    if (!complete)
      ctx.addIssue({ code: "custom", message: "빠른조회 정보를 모두 입력하세요." });
  });

const quickUpdateSchema = z
  .object({
    connectionId: z.string().regex(/^[a-f0-9]{64}$/),
    organization,
    credentialType: z.enum(["account", "fast", "id"]),
    alias: z.string().trim().max(40),
    quickId: z.string().trim().max(200).default(""),
    quickPassword: z.string().max(200).default(""),
    fastId: z.string().trim().max(200).default(""),
    fastPassword: z.string().max(200).default(""),
    account: z.preprocess(
      (value) => String(value ?? "").replace(/\D/g, ""),
      z.string().max(40),
    ),
    accountPassword: z.string().max(200).default(""),
    identity: z.union([z.literal(""), z.string().regex(/^\d{6}$/)]).default(""),
  })
  .strict();

const quickConnectionIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const bankSyncSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
  .refine((value) => value.from <= value.to, "조회 기간을 확인하세요.");
export const cardSyncSchema = bankSyncSchema.refine(
  (value) => {
    const from = new Date(`${value.from}T00:00:00Z`),
      to = new Date(`${value.to}T00:00:00Z`);
    return to.getUTCFullYear() * 12 + to.getUTCMonth() -
      (from.getUTCFullYear() * 12 + from.getUTCMonth()) < 12;
  },
  "카드 조회 기간은 최대 12개월입니다.",
);

const number = (value) => {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const isoDate = (value) =>
  /^\d{8}$/.test(value || "")
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : "";
const maskAccount = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `•••• ${digits.slice(-4)}` : "번호 비공개";
};
const quickAccountKey = (account) =>
  [
    account.organization,
    account.credentialType,
    account.account || account.fastId || account.id,
  ].join(":");
const quickPeriodDays = {
  "0002": 90,
  "0004": 180,
  "0011": 365,
  "0020": 365,
  "0023": 90,
  "0027": 180,
  "0034": 365,
  "0037": 90,
  "0048": 31,
  "0081": 90,
  "0089": 365,
};
const splitPeriod = (period, maxDays) => {
  if (!maxDays) return [period];
  const chunks = [],
    end = new Date(`${period.to}T00:00:00Z`);
  let start = new Date(`${period.from}T00:00:00Z`);
  while (start <= end) {
    const chunkEnd = new Date(
      Math.min(end.getTime(), start.getTime() + (maxDays - 1) * 86_400_000),
    );
    chunks.push({ from: inputDate(start), to: inputDate(chunkEnd) });
    start = new Date(chunkEnd.getTime() + 86_400_000);
  }
  return chunks;
};
const inputDate = (date) => date.toISOString().slice(0, 10);
const compactDate = (value) => value.replaceAll("-", "");
const cardMonths = ({ from, to }) => {
  const months = [],
    end = to.slice(0, 7);
  let current = from.slice(0, 7);
  while (current <= end) {
    months.push(current.replace("-", ""));
    const date = new Date(`${current}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    current = inputDate(date).slice(0, 7);
  }
  return months;
};
const threeMonthCutoff = (to) => {
  const date = new Date(`${to}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 3);
  return inputDate(date);
};
const previousDate = (value) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return inputDate(date);
};
const encryptCredential = (publicKey, value) => {
  const compact = publicKey
      .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ""),
    lines = compact.match(/.{1,64}/g)?.join("\n") || "",
    pem = `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
  return publicEncrypt(
    { key: pem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(value, "utf8"),
  ).toString("base64");
};

function decodeResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(decodeURIComponent(text.replaceAll("+", " ")));
  }
}

function collectAccounts(value, found = new Map()) {
  if (!value || typeof value !== "object") return [...found.values()];
  if (value.resAccount) found.set(String(value.resAccount), value);
  for (const [key, child] of Object.entries(value))
    if (key.startsWith("res") && typeof child === "object")
      for (const item of list(child)) collectAccounts(item, found);
  return [...found.values()];
}

export function normalizeAccountResponse(organizationCode, data) {
  return collectAccounts(data).map((account) => ({
    id: hash(`${organizationCode}:${account.resAccount}`),
    organization: organizationCode,
    display: maskAccount(account.resAccountDisplay || account.resAccount),
    name: String(account.resAccountNickName || account.resAccountName || "계좌"),
    type: String(account.resAccountDeposit || ""),
    currency: String(account.resAccountCurrency || "KRW"),
    balance: number(account.resAccountBalance),
    available:
      account.resWithdrawalAmt === undefined
        ? number(account.resAccountBalance)
        : number(account.resWithdrawalAmt),
    lastTransactionDate: isoDate(account.resLastTranDate),
  }));
}

export function normalizeTransactionResponse(organizationCode, account, data) {
  const response = list(data).find(
      (item) => String(item?.resAccount || "") === String(account.raw),
    ) || list(data)[0] || {};
  const updatedAccount = {
    ...account.safe,
    balance: number(response.resAccountBalance ?? account.safe.balance),
    available: number(
      response.resWithdrawalAmt ?? response.resAccountBalance ?? account.safe.available,
    ),
    lastTransactionDate:
      isoDate(response.resLastTranDate) || account.safe.lastTransactionDate,
  };
  const transactions = list(response.resTrHistoryList).map((row) => {
    const incoming = number(row.resAccountIn),
      outgoing = number(row.resAccountOut),
      description = [
        row.resAccountDesc1,
        row.resAccountDesc2,
        row.resAccountDesc3,
        row.resAccountDesc4,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" · ");
    return {
      id: hash(
        [
          organizationCode,
          account.raw,
          row.resAccountTrDate,
          row.resAccountTrTime,
          incoming,
          outgoing,
          description,
        ].join(":"),
      ),
      accountId: account.safe.id,
      date: isoDate(row.resAccountTrDate),
      time: String(row.resAccountTrTime || ""),
      direction: incoming > 0 ? "in" : "out",
      amount: incoming || outgoing,
      description: description || "입출금",
      balanceAfter: number(row.resAfterTranBalance),
    };
  });
  return { account: updatedAccount, transactions };
}

const collectApprovalRows = (value, found = []) => {
  if (!value || typeof value !== "object") return found;
  if (value.resUsedDate && value.resMemberStoreName !== undefined) found.push(value);
  else
    for (const child of Object.values(value))
      if (child && typeof child === "object")
        for (const item of list(child)) collectApprovalRows(item, found);
  return found;
};

const collectBillingRows = (value, month = "", found = []) => {
  if (!value || typeof value !== "object") return found;
  const nextMonth = value.__month || month;
  if (
    value.resTotalAmount !== undefined ||
    value.resAmountOutstanding !== undefined ||
    value.resChargeHistoryList !== undefined
  )
    found.push({ ...value, __month: nextMonth });
  else
    for (const child of Object.values(value))
      if (child && typeof child === "object")
        for (const item of list(child)) collectBillingRows(item, nextMonth, found);
  return found;
};

export function normalizeCardSync(
  organizationCode,
  approvalData,
  billingData,
  period,
) {
  const cardName =
      cardOptions.find(({ value }) => value === organizationCode)?.label ||
      organizationCode,
    source = `codef-card-${organizationCode}`;
  const billRows = collectBillingRows(billingData);
  const billedByApproval = new Map();
  for (const bill of billRows)
    for (const row of list(bill?.resChargeHistoryList))
      if (row?.resApprovalNo) billedByApproval.set(String(row.resApprovalNo), row);
  const transactions = collectApprovalRows(approvalData).map((row) => {
    // Some issuers emit a cancellation as a separate negative row instead of resCancelYN.
    const date = isoDate(row.resUsedDate),
      signed = number(row.resUsedAmount),
      amount = Math.abs(signed),
      approvalNo = String(row.resApprovalNo || ""),
      billed = billedByApproval.get(approvalNo),
      installment = String(row.resInstallmentMonth || "").trim(),
      evidence = [
        row.resPaymentType === "2"
          ? `할부 ${installment || "개월 미확인"}`
          : "일시불",
        row.resPaymentDueDate ? `결제예정일 ${isoDate(row.resPaymentDueDate)}` : "",
        billed ? "청구내역에서 원거래 확인" : "",
      ].filter(Boolean);
    return {
      id: hash(
        [
          organizationCode,
          approvalNo,
          date,
          row.resUsedTime || "",
          row.resMemberStoreName,
          signed,
        ].join(":"),
      ),
      date,
      merchant: String(row.resMemberStoreName || "카드 이용"),
      amount,
      category: "other",
      status:
        signed < 0
          ? "cancelled"
          : { 1: "cancelled", 2: "partial", 3: "rejected" }[
              String(row.resCancelYN || "0")
            ] || "unpaid",
      source,
      evidence: `${evidence.join(" · ")}. 승인내역만으로 납부 완료를 확정하지 않음.`,
    };
  });
  const bills = billRows.map((bill) => ({
    organization: organizationCode,
    cardName,
    month: String(bill.__month || ""),
    totalAmount: number(bill.resTotalAmount),
    outstanding: number(bill.resAmountOutstanding),
    preWithdrawal: number(bill.resPreWithdrawal),
    paymentDueDate: isoDate(bill.resPaymentDueDate),
  }));
  return {
    transactions,
    from: period.from,
    to: period.to,
    complete: false,
    source,
    bills,
  };
}

function createVault(path) {
  let memory = null;
  const keyPath = path && path + ".key";
  const key = () => {
    if (!path) return null;
    if (!existsSync(keyPath)) {
      writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
      try {
        chmodSync(keyPath, 0o600);
      } catch {}
    }
    return readFileSync(keyPath);
  };
  return {
    read() {
      if (!path) return memory;
      if (!existsSync(path)) return null;
      const value = JSON.parse(readFileSync(path, "utf8")),
        decipher = createDecipheriv(
          "aes-256-gcm",
          key(),
          Buffer.from(value.iv, "base64"),
        );
      decipher.setAuthTag(Buffer.from(value.tag, "base64"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(value.data, "base64")),
          decipher.final(),
        ]).toString("utf8"),
      );
    },
    write(value) {
      if (!path) {
        memory = structuredClone(value);
        return;
      }
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key(), iv),
        data = Buffer.concat([
          cipher.update(JSON.stringify(value), "utf8"),
          cipher.final(),
        ]),
        next = `${path}.${process.pid}.tmp`;
      writeFileSync(
        next,
        JSON.stringify({
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          data: data.toString("base64"),
        }),
        { mode: 0o600 },
      );
      renameSync(next, path);
    },
    clear() {
      memory = null;
      for (const file of [path, keyPath])
        if (file && existsSync(file)) unlinkSync(file);
    },
  };
}

export function createCodefBank({ fetcher = fetch, vaultPath = null } = {}) {
  const vault = createVault(vaultPath);
  let lastSync = null,
    lastCardSync = null;
  const status = () => {
    const config = vault.read();
    const organizations = [
      ...new Set([
        ...(config?.organizations || []),
        ...(config?.quickAccounts || []).map((account) => account.organization),
      ]),
    ];
    return {
      connected: !!config,
      ready: !!config?.connectedId || !!config?.quickAccounts?.length,
      environment: config?.environment || "demo",
      organizations,
      accountCount:
        (config?.connectedAccountCount ||
          (config?.connectedId ? config?.organizations?.length || 1 : 0)) +
        (config?.quickAccounts?.length || 0),
      connectedId: config?.connectedId
        ? `••••${config.connectedId.slice(-4)}`
        : "",
      methods: [
        ...(config?.registrationMethods || (config?.connectedId ? ["connected"] : [])),
        ...(config?.quickAccounts?.length ? ["quick"] : []),
      ],
      quickConnections: (config?.quickAccounts || []).map((account) => ({
        id: hash(quickAccountKey(account)),
        organization: account.organization,
        credentialType: account.credentialType,
        alias: account.alias || "",
        hasIdentity: !!account.identity,
        display: account.account
          ? maskAccount(account.account)
          : account.credentialType === "id"
            ? "인터넷뱅킹 ID"
            : "조회전용 정보",
      })),
      lastSync,
    };
  };
  const cardStatus = () => {
    const config = vault.read(),
      cards = config?.cards || (config?.card ? [config.card] : []);
    return {
      connected: !!cards.length,
      ready: !!cards.length,
      cards: cards.map((card) => ({
        organization: card.organization,
        name:
          cardOptions.find(({ value }) => value === card.organization)?.label ||
          card.organization,
        method: card.method,
        display: card.cardNo ? maskAccount(card.cardNo) : "공동인증서",
      })),
      lastSync: lastCardSync,
    };
  };
  const request = async (config, token, path, body) => {
    const host =
      config.environment === "production"
        ? "https://api.codef.io"
        : "https://development.codef.io";
    const response = await fetcher(host + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });
    if (!response.ok) throw Error(`CODEF 요청 실패: HTTP ${response.status}`);
    const result = decodeResponse(await response.text());
    if (result.result?.code === "CF-03002" && result.data?.continue2Way)
      throw Error("금융사 추가 인증이 필요합니다. CODEF에서 인증을 마친 뒤 다시 동기화하세요.");
    if (result.result?.code !== "CF-00000") {
      const code = String(result.result?.code || "응답 형식 오류"),
        failure = list(result.data?.errorList)[0],
        message =
          code === "CF-12401"
            ? "로그인 파라미터가 누락되었습니다. 연결 방식과 입력 항목을 확인하세요."
            : String(failure?.message || result.result?.message || "");
      throw Error(`CODEF 조회 실패: ${code}${message ? ` · ${message}` : ""}`);
    }
    return result.data;
  };
  const accessToken = async (config) => {
    const response = await fetcher("https://oauth.codef.io/oauth/token", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
            "base64",
          ),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=read",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error(`CODEF 토큰 요청 실패: HTTP ${response.status}`);
    const value = (await response.json()).access_token;
    if (!value) throw Error("CODEF 토큰 응답 형식이 올바르지 않습니다.");
    return value;
  };
  const connectAccount = async (config, account, token = null) => {
    const registration = {
      countryCode: "KR",
      businessType: "BK",
      clientType: "P",
      organization: account.organization,
      loginType: account.method === "certificate" ? "0" : "1",
      password: encryptCredential(
        config.publicKey,
        account.method === "certificate"
          ? account.certificatePassword
          : account.loginPassword,
      ),
      ...(account.birthDate ? { birthDate: account.birthDate } : {}),
      ...(account.method === "certificate"
        ? account.certType === "pfx"
          ? { certType: "pfx", certFile: account.certFile }
          : { certType: "1", derFile: account.derFile, keyFile: account.keyFile }
        : { id: account.loginId }),
    };
    const data = await request(
      config,
      token || (await accessToken(config)),
      config.connectedId ? "/v1/account/add" : "/v1/account/create",
      {
        accountList: [registration],
        ...(config.connectedId ? { connectedId: config.connectedId } : {}),
      },
    );
    if (!data?.connectedId) {
      const failure = list(data?.errorList)[0];
      throw Error(
        `은행 계정 등록 실패: ${String(failure?.code || "응답 형식 오류")}${failure?.message ? ` · ${failure.message}` : ""}`,
      );
    }
    return {
      ...config,
      connectedId: data.connectedId,
      organizations: [...new Set([...config.organizations, account.organization])],
      registrationMethods: [
        ...new Set([...(config.registrationMethods || []), account.method]),
      ],
      connectedAccountCount:
        (config.connectedAccountCount ||
          (config.connectedId ? config.organizations.length : 0)) + 1,
      birthDate: account.birthDate || config.birthDate,
    };
  };
  return {
    status,
    cardStatus,
    configure(input) {
      const next = bankConnectionSchema.parse(input),
        current = vault.read();
      vault.write({
        ...current,
        ...next,
        connectedId: next.connectedId || current?.connectedId || "",
        organizations: next.organizations.length
          ? next.organizations
          : current?.organizations || [],
        birthDate: next.birthDate || current?.birthDate || "",
      });
      return status();
    },
    revealConnection() {
      const config = vault.read();
      if (!config) throw Error("확인할 CODEF 연결 정보가 없습니다.");
      return {
        environment: config.environment,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        publicKey: config.publicKey,
        connectedId: config.connectedId,
      };
    },
    clear() {
      vault.clear();
      lastSync = null;
      return status();
    },
    async register(input) {
      const account = bankRegistrationSchema.parse(input),
        config = vault.read();
      if (!config) throw Error("CODEF 키를 먼저 저장하세요.");
      vault.write(await connectAccount(config, account));
      return status();
    },
    async registerCard(input) {
      const account = cardRegistrationSchema.parse(input),
        config = vault.read(),
        cards = config?.cards || (config?.card ? [config.card] : []),
        updating = cards.some(
          ({ organization }) => organization === account.organization,
        );
      if (!config) throw Error("CODEF 키를 먼저 저장하세요.");
      const registration = {
          countryCode: "KR",
          businessType: "CD",
          clientType: "P",
          organization: account.organization,
          loginType: account.method === "certificate" ? "0" : "1",
          password: encryptCredential(
            config.publicKey,
            account.method === "certificate"
              ? account.certificatePassword
              : account.loginPassword,
          ),
          ...(account.birthDate ? { birthDate: account.birthDate } : {}),
          ...(account.method === "certificate"
            ? account.certType === "pfx"
              ? { certType: "pfx", certFile: account.certFile }
              : { certType: "1", derFile: account.derFile, keyFile: account.keyFile }
            : {
                id: account.loginId,
                ...(account.cardNo
                  ? {
                      cardNo: account.cardNo,
                      cardPassword: encryptCredential(
                        config.publicKey,
                        account.cardPassword,
                      ),
                    }
                  : {}),
              }),
        },
        data = await request(
          config,
          await accessToken(config),
          updating
            ? "/v1/account/update"
            : config.connectedId
              ? "/v1/account/add"
              : "/v1/account/create",
          {
            accountList: [registration],
            ...(config.connectedId ? { connectedId: config.connectedId } : {}),
          },
        );
      if (!data?.connectedId) {
        const failure = list(data?.errorList)[0];
        throw Error(
          `카드사 등록 실패: ${String(failure?.code || "응답 형식 오류")}${failure?.message ? ` · ${failure.message}` : ""}`,
        );
      }
      const { card: _legacyCard, ...nextConfig } = config,
        storedCard = {
          organization: account.organization,
          method: account.method,
          birthDate: account.birthDate,
          ...(account.method === "id" && account.cardNo
            ? { cardNo: account.cardNo, cardPassword: account.cardPassword }
            : {}),
        };
      vault.write({
        ...nextConfig,
        connectedId: data.connectedId || config.connectedId,
        cards: [
          ...cards.filter(
            ({ organization }) => organization !== account.organization,
          ),
          storedCard,
        ],
      });
      return cardStatus();
    },
    configureQuick(input) {
      const account = quickRegistrationSchema.parse(input),
        config = vault.read();
      if (!config) throw Error("CODEF 키를 먼저 저장하세요.");
      const quickAccounts = (config.quickAccounts || []).filter(
        (item) => quickAccountKey(item) !== quickAccountKey(account),
      );
      vault.write({ ...config, quickAccounts: [...quickAccounts, account] });
      return status();
    },
    updateQuick(input) {
      const update = quickUpdateSchema.parse(input),
        config = vault.read();
      if (!config) throw Error("CODEF 키를 먼저 저장하세요.");
      let found = false;
      const quickAccounts = (config.quickAccounts || []).map((account) => {
        if (hash(quickAccountKey(account)) !== update.connectionId) return account;
        found = true;
        const sameType = account.credentialType === update.credentialType;
        return quickRegistrationSchema.parse({
          organization: update.organization,
          credentialType: update.credentialType,
          alias: update.alias,
          id:
            update.credentialType === "id"
              ? update.quickId || (sameType ? account.id : "")
              : "",
          password:
            update.credentialType === "id"
              ? update.quickPassword || (sameType ? account.password : "")
              : "",
          fastId:
            update.credentialType === "fast"
              ? update.fastId || (sameType ? account.fastId : "")
              : "",
          fastPassword:
            update.credentialType === "fast"
              ? update.fastPassword || (sameType ? account.fastPassword : "")
              : "",
          account:
            ["account", "id"].includes(update.credentialType)
              ? update.account || account.account
              : "",
          accountPassword:
            ["account", "id"].includes(update.credentialType)
              ? update.accountPassword || account.accountPassword
              : "",
          identity: update.identity || (sameType ? account.identity : ""),
        });
      });
      if (!found) throw Error("수정할 빠른조회 연결을 찾지 못했습니다.");
      vault.write({ ...config, quickAccounts });
      return status();
    },
    revealQuick(input) {
      const id = quickConnectionIdSchema.parse(input),
        config = vault.read(),
        account = (config?.quickAccounts || []).find(
          (item) => hash(quickAccountKey(item)) === id,
        );
      if (!account) throw Error("확인할 빠른조회 연결을 찾지 못했습니다.");
      return {
        account: account.account,
        accountPassword: account.accountPassword,
        quickId: account.id,
        quickPassword: account.password,
        fastId: account.fastId,
        fastPassword: account.fastPassword,
        identity: account.identity,
      };
    },
    removeQuick(input) {
      const id = quickConnectionIdSchema.parse(input),
        config = vault.read();
      if (!config) throw Error("CODEF 키를 먼저 저장하세요.");
      const quickAccounts = (config.quickAccounts || []).filter(
        (account) => hash(quickAccountKey(account)) !== id,
      );
      if (quickAccounts.length === (config.quickAccounts || []).length)
        throw Error("끊을 빠른조회 연결을 찾지 못했습니다.");
      vault.write({ ...config, quickAccounts });
      return status();
    },
    async sync(input) {
      const period = bankSyncSchema.parse(input),
        storedConfig = vault.read();
      let config = storedConfig;
      if (!config) throw Error("CODEF 계좌 연결값을 먼저 입력하세요.");
      if (!config.connectedId && !config.quickAccounts?.length)
        throw Error("은행 계정 또는 빠른조회를 먼저 연결하세요.");
      if (!config.organizations.length && !config.quickAccounts?.length)
        throw Error("조회할 은행 계정을 먼저 등록하세요.");
      const token = await accessToken(config);
      const accounts = [],
        transactions = [],
        warnings = [];
      const quickAccounts = [];
      for (const quick of config.quickAccounts || []) {
        if (quick.credentialType !== "id") {
          quickAccounts.push(quick);
          continue;
        }
        try {
          config = await connectAccount(
            config,
            {
              method: "id",
              organization: quick.organization,
              loginId: quick.id,
              loginPassword: quick.password,
              birthDate: quick.identity,
            },
            token,
          );
        } catch (error) {
          quickAccounts.push(quick);
          warnings.push(`${quick.organization}: ${error.message}`);
        }
      }
      if (quickAccounts.length !== (config.quickAccounts || []).length) {
        config = { ...config, quickAccounts };
        vault.write(config);
      }
      for (const organizationCode of config.organizations) {
        if (!config.connectedId) break;
        try {
          const data = await request(
            config,
            token,
            "/v1/kr/bank/p/account/account-list",
            {
              organization: organizationCode,
              connectedId: config.connectedId,
              ...(config.birthDate ? { birthDate: config.birthDate } : {}),
            },
          );
          const rawAccounts = collectAccounts(data);
          for (const raw of rawAccounts) {
            const safe = normalizeAccountResponse(organizationCode, raw)[0];
            if (!safe) continue;
            if (!["10", "11"].includes(safe.type)) {
              accounts.push(safe);
              continue;
            }
            const result = await request(
              config,
              token,
              "/v1/kr/bank/p/account/transaction-list",
              {
                organization: organizationCode,
                connectedId: config.connectedId,
                account: String(raw.resAccount),
                startDate: period.from.replaceAll("-", ""),
                endDate: period.to.replaceAll("-", ""),
                orderBy: "0",
                inquiryType: "1",
                ...(config.birthDate ? { birthDate: config.birthDate } : {}),
              },
            );
            const normalized = normalizeTransactionResponse(
              organizationCode,
              { raw: String(raw.resAccount), safe },
              result,
            );
            accounts.push(normalized.account);
            transactions.push(...normalized.transactions);
          }
        } catch (error) {
          warnings.push(`${organizationCode}: ${error.message}`);
        }
      }
      const quickResults = await Promise.all(quickAccounts.map(async (quick) => {
        try {
          const credentials =
            quick.credentialType === "id"
              ? {
                  account: quick.account,
                  accountPassword: encryptCredential(
                    config.publicKey,
                    quick.accountPassword,
                  ),
                  id: quick.id,
                  password: encryptCredential(config.publicKey, quick.password),
                }
              : quick.credentialType === "fast"
                ? {
                    fastId: quick.fastId,
                    fastPassword: encryptCredential(config.publicKey, quick.fastPassword),
                  }
                : {
                    account: quick.account,
                    accountPassword: encryptCredential(
                      config.publicKey,
                      quick.accountPassword,
                    ),
                  };
          const raw = quick.account || quick.fastId || quick.id,
            safe = {
              id: hash(`${quick.organization}:${raw}`),
              organization: quick.organization,
              display: quick.account ? maskAccount(quick.account) : "빠른조회",
              name: "입출금 계좌",
              type: "11",
              currency: "KRW",
              balance: 0,
              available: 0,
              lastTransactionDate: "",
            };
          const chunks = await Promise.all(
            splitPeriod(period, quickPeriodDays[quick.organization]).map(async (chunk) => {
            const data = await request(
                config,
                token,
                "/v1/kr/bank/p/fast-account/transaction-list",
                {
                  organization: quick.organization,
                  ...credentials,
                  startDate: chunk.from.replaceAll("-", ""),
                  endDate: chunk.to.replaceAll("-", ""),
                  orderBy: "0",
                  ...(quick.identity ? { identity: quick.identity } : {}),
                },
              ),
              normalized = normalizeTransactionResponse(
                quick.organization,
                { raw, safe },
                data,
              );
              return normalized;
            }),
          );
          return {
            accounts: chunks.map(({ account }) => account),
            transactions: chunks.flatMap(({ transactions }) => transactions),
          };
        } catch (error) {
          const label = quick.account ? maskAccount(quick.account) : "빠른조회";
          return {
            accounts: [],
            transactions: [],
            warning: `${quick.organization} ${label}: ${error.message}`,
          };
        }
      }));
      for (const result of quickResults) {
        accounts.push(...result.accounts);
        transactions.push(...result.transactions);
        if (result.warning) warnings.push(result.warning);
      }
      if (!accounts.length && warnings.length) throw Error(warnings.join(" · "));
      lastSync = new Date().toISOString();
      return {
        accounts: [...new Map(accounts.map((account) => [account.id, account])).values()],
        transactions: [
          ...new Map(transactions.map((transaction) => [transaction.id, transaction])).values(),
        ],
        warnings,
        coverage: { ...period, at: lastSync },
      };
    },
    async syncCard(input) {
      const period = cardSyncSchema.parse(input),
        config = vault.read(),
        cards = config?.cards || (config?.card ? [config.card] : []);
      if (!config?.connectedId || !cards.length)
        throw Error("카드사를 먼저 연결하세요.");
      const token = await accessToken(config),
        transactions = [],
        bills = [],
        warnings = [];
      let approvalSuccess = 0;
      for (const card of cards) {
        const name =
            cardOptions.find(({ value }) => value === card.organization)?.label ||
            card.organization,
          common = {
            connectedId: config.connectedId,
            organization: card.organization,
            ...(card.birthDate ? { birthDate: card.birthDate } : {}),
            ...(card.cardNo
              ? {
                  loginCardNo: card.cardNo,
                  cardPassword: encryptCredential(
                    config.publicKey,
                    card.cardPassword,
                  ),
                }
              : {}),
          },
          approvals = [],
          cardBills = [],
          cutoff = threeMonthCutoff(period.to),
          ranges =
            card.organization === "0302"
              ? [
                  ...(period.from < cutoff
                    ? [{ from: period.from, to: previousDate(cutoff), type: "2" }]
                    : []),
                  ...(period.to >= cutoff
                    ? [{ from: period.from > cutoff ? period.from : cutoff, to: period.to, type: "0" }]
                    : []),
                ]
              : [{ ...period, type: "0" }];
        try {
          for (const range of ranges)
            approvals.push(
              await request(
                config,
                token,
                "/v1/kr/card/p/account/approval-list",
                {
                  ...common,
                  startDate: compactDate(range.from),
                  endDate: compactDate(range.to),
                  orderBy: "0",
                  inquiryType: "1",
                  memberStoreInfoType: range.type,
                },
              ),
            );
          approvalSuccess += 1;
        } catch (error) {
          warnings.push(`${name} 승인내역: ${error.message}`);
        }
        for (const month of cardMonths(period))
          try {
            const data = await request(
              config,
              token,
              "/v1/kr/card/p/account/billing-list",
              { ...common, startDate: month },
            );
            cardBills.push({ __month: month, data });
          } catch (error) {
            warnings.push(`${name} ${month} 청구내역: ${error.message}`);
          }
        const normalized = normalizeCardSync(
          card.organization,
          approvals,
          cardBills,
          period,
        );
        transactions.push(...normalized.transactions);
        bills.push(...normalized.bills);
      }
      if (!approvalSuccess) throw Error(warnings.join(" · "));
      lastCardSync = {
        ...period,
        at: new Date().toISOString(),
        transactionCount: transactions.length,
        billCount: bills.length,
        cards: cards.map(({ organization }) => organization),
      };
      return {
        transactions,
        from: period.from,
        to: period.to,
        complete: false,
        source: "codef-card",
        bills,
        warnings,
        coverage: lastCardSync,
      };
    },
  };
}
