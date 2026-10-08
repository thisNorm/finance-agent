import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createStore, root } from "./store.js";
import { categories, monthSchema } from "./finance.js";
import { connectionModels, createAI } from "./ai.js";
import { normalizeImport } from "./import.js";
import { bankOptions, cardOptions, createCodefBank } from "./codef-bank.js";
import { createNotifier, notificationSettingsSchema } from "./notify.js";
import { createAutoSync, autoSyncSettingsSchema } from "./autosync.js";
import { createToss } from "./toss.js";
import { createInvest } from "./invest.js";
import { dueReminders } from "./subscriptions.js";
import { createMail } from "./mail.js";
import { createPush } from "./push.js";
import { currentDate } from "./finance.js";

export async function buildServer({
  store = createStore(),
  push = createPush({ vaultPath: store.databasePath === ":memory:" ? null : store.databasePath + ".push" }),
  notifier = createNotifier(store, { push }),
  ai = createAI(store, fetch, undefined, notifier),
  bank = null,
  toss = null,
  mail = null,
  dev = false,
  serveUI = true,
  autoReview = serveUI,
} = {}) {
  bank ||= createCodefBank({
    vaultPath:
      store.databasePath === ":memory:"
        ? null
        : store.databasePath + ".codef",
  });
  toss ||= createToss({
    vaultPath: store.databasePath === ":memory:" ? null : store.databasePath + ".toss",
  });
  mail ||= createMail({
    vaultPath: store.databasePath === ":memory:" ? null : store.databasePath + ".mail",
    ai,
    lang: () => store.getSetting("lang"),
  });
  const app = Fastify({
    logger: false,
    bodyLimit: 2_000_000,
    requestTimeout: 200000,
  });
  const token = randomBytes(32).toString("hex");
  function scheduleReview(month) {
    if (!autoReview || ai.status().busy) return;
    const s = store.overview(month),
      r = s.aiReview,
      monthRows = s.analysis.count + s.bankCashflow.count;
    if (
      (!s.transactions.length && !s.bankTransactions.length) ||
      // Nothing happened in this month and nothing is waiting to be classified.
      (!monthRows && !r.pendingCount) ||
      (!r.stale && r.status === "error") ||
      (!r.stale && r.status === "complete" && !r.pendingCount)
    )
      return;
    void ai.review(s.analysis.month).catch(() => {});
  }
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host || "";
    const localHost = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
    const tailscaleHost =
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::\d+)?$/i.test(host) &&
      Boolean(req.headers["tailscale-user-login"]);
    if (!localHost && !tailscaleHost)
      return reply
        .code(403)
        .send({ error: "로컬 호스트에서만 접근할 수 있습니다." });
    const origin = req.headers.origin;
    if (origin && origin !== (tailscaleHost ? "https://" : "http://") + host)
      return reply
        .code(403)
        .send({ error: "외부 사이트 요청은 허용하지 않습니다." });
    const site = req.headers["sec-fetch-site"];
    if (
      ["cross-site", "same-site"].includes(site) &&
      !(
        req.headers["sec-fetch-mode"] === "navigate" &&
        req.headers["sec-fetch-dest"] === "document"
      )
    )
      return reply
        .code(403)
        .send({ error: "외부 페이지에서 호출할 수 없습니다." });
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    if (!dev)
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (req.url.startsWith("/api/") && req.url !== "/api/session") {
      const given = String(req.headers["x-finance-token"] || "");
      if (
        Buffer.byteLength(given) !== token.length ||
        !timingSafeEqual(Buffer.from(given), Buffer.from(token))
      )
        return reply
          .code(403)
          .send({ error: "페이지를 새로고침해 연결하세요." });
    }
  });
  app.setErrorHandler((err, req, reply) => {
    const code = [403, 404, 413, 429].includes(err.statusCode)
      ? err.statusCode
      : 400;
    const message =
      err instanceof z.ZodError
        ? /[가-힣]/.test(err.issues[0]?.message || "") ? err.issues[0].message : "입력 형식·금액·날짜를 확인하세요."
        : code === 404
          ? "요청한 경로가 없습니다."
          : code === 403
            ? "접근할 수 없는 경로입니다."
            : code === 413
              ? "2MB 이하 파일을 가져오세요."
              : err.code === "FST_ERR_CTP_INVALID_JSON_BODY" || err instanceof SyntaxError
                ? "보낸 자료를 읽지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요."
                : // app messages are Korean sentences; anything else is library/system wording
                  /[가-힣]/.test(err.message || "") || err.message?.startsWith("SQLITE")
                  ? err.message
                  : "요청을 처리하지 못했습니다.";
    reply.code(code).send({
      error: message?.startsWith("SQLITE")
        ? "저장 실패. 기존 자료를 유지했습니다."
        : message || "요청을 처리하지 못했습니다.",
    });
  });
  app.get("/api/session", async () => ({
    token,
    categories,
    bankOptions,
    cardOptions,
    bankConnection: bank.status(),
    cardConnection: bank.cardStatus(),
    tossConnection: toss.status(),
    mailConnection: mail.status(),
    connectionModels,
    connection: ai.status(),
  }));
  app.get("/api/overview", async (req) => {
    const month = req.query.month
      ? monthSchema.parse(req.query.month)
      : undefined;
    scheduleReview(month);
    const state = store.overview(month);
    if (ai.status().reviewMonth === state.analysis.month)
      state.aiReview = { ...state.aiReview, status: "running" };
    return state;
  });
  app.post("/api/tools/:name", async (req) => {
    const r = store.call(req.params.name, req.body);
    scheduleReview();
    return r;
  });
  app.post("/api/import", async (req) => {
    const r = store.call("import_transactions", normalizeImport(req.body));
    scheduleReview();
    return r;
  });
  app.post("/api/bank/connection", async (req) => bank.configure(req.body));
  app.post("/api/bank/connection/reveal", async () => bank.revealConnection());
  app.delete("/api/bank/connection", async () => bank.clear());
  app.post("/api/bank/register", async (req) => bank.register(req.body));
  app.post("/api/bank/quick", async (req) => bank.configureQuick(req.body));
  app.post("/api/bank/quick/update", async (req) => bank.updateQuick(req.body));
  app.post("/api/bank/quick/:id/reveal", async (req) =>
    bank.revealQuick(req.params.id),
  );
  app.delete("/api/bank/quick/:id", async (req) => bank.removeQuick(req.params.id));
  app.post("/api/bank/sync", async (req) => {
    const result = await bank.sync(req.body);
    const overview = store.saveBankSync(result);
    scheduleReview(overview.analysis.month);
    return {
      status: bank.status(),
      overview,
      warnings: result.warnings,
    };
  });
  app.post("/api/card/register", async (req) => bank.registerCard(req.body));
  app.post("/api/card/sync", async (req) => {
    const result = await bank.syncCard(req.body);
    const overview = store.saveCardSync(result);
    scheduleReview(overview.analysis.month);
    return {
      status: bank.cardStatus(),
      overview,
      warnings: result.warnings,
    };
  });
  // Toss Securities: read-only holdings and cash, shown apart from spendable money.
  const tossSync = async () => store.saveInvestments(await toss.sync());
  app.post("/api/toss/connection", async (req) => {
    const status = await toss.configure(req.body);
    return { status, overview: await tossSync() };
  });
  app.delete("/api/toss/connection", async () => {
    store.clearInvestments();
    return toss.clear();
  });
  app.post("/api/toss/sync", async () => ({ status: toss.status(), overview: await tossSync() }));
  // Investing: profile, suggestions (sent only on the user's click) and the funded autopilot pool.
  const invest = createInvest({ store, toss, ai, notifier });
  const investState = async () => {
    const st = invest.state();
    const valuation = toss.status().ready && st.settings.principal ? await invest.valuation().catch(() => null) : null;
    return { ...st, valuation };
  };
  app.get("/api/invest", investState);
  app.get("/api/invest/charts", async () => invest.charts());
  app.post("/api/invest/profile", async () => (await invest.buildProfile(), investState()));
  app.post("/api/invest/interview", async (req) => (await invest.saveInterview(req.body), investState()));
  app.post("/api/invest/suggestions", async () => (await invest.suggest(), investState()));
  app.post("/api/invest/suggestions/:id/order", async (req) => {
    await invest.orderSuggestion(z.string().uuid().parse(req.params.id));
    await tossSync().catch(() => {});
    return investState();
  });
  app.post("/api/invest/autopilot", async (req) => (invest.configure(req.body), investState()));
  app.post("/api/invest/autopilot/run", async () => (await invest.run("manual"), investState()));
  app.post("/api/invest/autopilot/stop", async () => (invest.stop(), investState()));
  // Subscriptions: confirm or dismiss what was found, adjust it, or add ones paid where the app can't see.
  app.post("/api/subscriptions/decide", async (req) => store.decideSubscription(req.body));
  app.post("/api/subscriptions/cancel", async (req) => store.cancelSubscription(req.body));
  app.post("/api/subscriptions/update", async (req) => store.updateSubscription(req.body));
  app.post("/api/subscriptions/manual", async (req) => store.addManualSubscription(req.body));
  app.delete("/api/subscriptions/manual/:id", async (req) => store.removeManualSubscription(z.string().uuid().parse(req.params.id)));
  // Mailboxes: read-only, app password, two fixed servers. A scan reads subscription mail and the result
  // is cross-checked with card and bank charges in the subscription list.
  app.get("/api/mail", async () => mail.status());
  app.post("/api/mail/accounts", async (req) => mail.add(req.body));
  app.delete("/api/mail/accounts/:provider", async (req) => mail.remove(req.params.provider));
  app.post("/api/mail/scan", async () => {
    const found = await mail.scan();
    return { status: mail.status(), overview: store.saveMailSubscriptions(found) };
  });
  // A few days before a subscription charges, once per charge date, between 9 and 21 o'clock Seoul time.
  const remindSubscriptions = () => {
    const hour = (new Date().getUTCHours() + 9) % 24;
    if (hour < 9 || hour > 21) return;
    const today = currentDate(),
      settings = store.overview()["setting:subscriptions"],
      due = dueReminders(store.subscriptions(), today, settings?.reminded || {});
    for (const s of due) {
      const en = store.getSetting("lang") === "en";
      notifier
        ?.send(
          en ? "Alaseo · subscription coming up" : "알아서 · 구독 결제 예정",
          en ? `${s.name} ₩${s.amount.toLocaleString("en-US")} on ${s.nextDate}` : `${s.name} ${s.amount.toLocaleString("ko-KR")}원이 ${s.nextDate}에 결제될 예정입니다.`,
        )
        .catch(() => {});
      store.markReminded(s.key, s.nextDate);
    }
    // cancellations being followed: charged anyway (at once), deadline close and still not done, and confirmed done
    const en = store.getSetting("lang") === "en",
      daysTo = (d) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
    for (const i of store.subscriptions().items.filter((x) => x.cancel)) {
      const c = i.cancel,
        told = settings?.cancels?.[i.key]?.notified || {};
      const note =
        c.state === "charged" && told.charged !== c.chargedOn
          ? ["charged", c.chargedOn, en ? `${i.name} charged on ${c.chargedOn} after you asked to cancel. It may not have gone through — open the chat for a refund request.` : `${i.name} 해지를 요청했는데 ${c.chargedOn}에 결제됐습니다. 해지가 안 됐을 수 있어요. 대화에서 환불 요청을 도와드릴게요.`]
          : c.state === "pending" && c.deadline && daysTo(c.deadline) >= 0 && daysTo(c.deadline) <= 2 && told.deadline !== c.deadline
            ? ["deadline", c.deadline, en ? `${i.name} charges again on ${c.deadline} and the cancellation isn't confirmed yet.` : `${i.name}은(는) ${c.deadline}에 다시 결제됩니다. 아직 해지가 확인되지 않았어요.`]
            : c.state === "done" && !told.done
              ? ["done", today, en ? `${i.name} looks cancelled.` : `${i.name} 해지가 확인됐습니다.`]
              : null;
      if (!note) continue;
      notifier?.send(en ? "Alaseo · cancellation" : "알아서 · 구독 해지", note[2]).catch(() => {});
      store.markCancelNotified(i.key, note[0], note[1]);
    }
  };
  app.post("/api/invest/dca", async (req) => (await invest.addDca(req.body), investState()));
  app.post("/api/invest/dca/:id", async (req) => (invest.updateDca(z.string().uuid().parse(req.params.id), req.body), investState()));
  app.delete("/api/invest/dca/:id", async (req) => (invest.removeDca(z.string().uuid().parse(req.params.id)), investState()));
  app.post("/api/analysis", async (req) => {
    const p = z.object({ month: monthSchema }).strict().parse(req.body);
    return ai.review(p.month, { force: true });
  });
  app.get("/api/connection", async () => ai.status());
  app.get("/api/models", async (req) => {
    const provider = z.enum(["codex", "claude", "openai", "anthropic", "openrouter"]).parse(req.query.provider);
    return { provider, models: await ai.models(provider) };
  });
  async function validateConnectionModel(input) {
    const provider = z.enum(["codex", "claude", "openai", "anthropic", "openrouter"]).parse(input?.provider);
    const model = z.string().trim().max(120).parse(input?.model);
    if (
      !(["codex", "claude"].includes(provider) && model === "") &&
      !(await ai.models(provider)).some(
        ({ value }) => value === model,
      )
    )
      throw Error("목록에 있는 AI 모델을 선택하세요.");
  }
  function reviewConnection() {
    if (autoReview)
      void ai.review(store.overview().analysis.month, { force: true }).catch(() => {});
  }
  app.post("/api/connection", async (req) => {
    await validateConnectionModel(req.body);
    const result = ai.configure(req.body);
    reviewConnection();
    return result;
  });
  app.get("/api/connections", async () => ai.status());
  app.post("/api/connections/auto-switch", async (req) => ai.setAutoSwitch(req.body));
  app.post("/api/connections/retry", async () => ai.retryPreferred());
  app.post("/api/connections", async (req) => {
    await validateConnectionModel(req.body);
    return ai.configure(req.body, { activate: false });
  });
  app.post("/api/connections/:id/use", async (req) => {
    const id = z.uuid().parse(req.params.id);
    const selected = ai.status().connections.find((c) => c.id === id);
    if (!selected) throw Error("저장된 AI 연결을 찾을 수 없습니다.");
    await validateConnectionModel(selected);
    const result = ai.select(id);
    reviewConnection();
    return result;
  });
  app.delete("/api/connections/:id", async (req) => ai.remove(req.params.id));
  app.delete("/api/connection", async () => ai.clear());
  app.post("/api/codex/status", async () => ai.codex.status());
  app.post("/api/codex/login", async () => ai.codex.login());
  app.post("/api/codex/logout", async () => ai.codex.logout());
  app.post("/api/claude/status", async () => ai.claude.status());
  app.post("/api/claude/login", async () => ai.claude.login());
  app.post("/api/claude/logout", async () => ai.claude.logout());
  app.post("/api/chat", async (req) => {
    const p = z
      .object({ message: z.string().min(1).max(4000), month: monthSchema })
      .strict()
      .parse(req.body);
    return ai.chat(p.message, p.month);
  });
  // What a chat proposal may do beyond storing values. Orders and running the autopilot now move real money,
  // so they stay buttons only.
  const needToss = () => {
    if (!toss.status().ready) throw Error("토스증권을 먼저 연결하세요.");
  };
  const chatRuns = {
    sync: () => autoSync.run("manual"),
    deep_sync: () => autoSync.run("deep"),
    mail_scan: async () => store.saveMailSubscriptions(await mail.scan()),
    analysis: (month) => ai.review(month, { force: true }),
    invest_profile: () => (needToss(), invest.buildProfile()),
    invest_suggestions: () => (needToss(), invest.suggest()),
    notify_test: () => notifier.test(),
  };
  // which mailboxes can send (providers only, never addresses) for the chat's cancellation mails
  ai.setExtraContext?.(() => ({ mailAccounts: mail.status().accounts.map((a) => a.provider) }));
  const quickByName = (name) => {
    const n = name.replace(/\s/g, ""),
      list = bank.status().quickConnections || [],
      hit = list.find((c) => c.alias && c.alias.replace(/\s/g, "") === n) || list.find((c) => (c.alias || "").includes(name) || String(c.display || "").endsWith(n));
    if (!hit) throw Error("말씀한 빠른조회 계좌를 찾지 못했습니다. 별칭이나 계좌 끝자리를 확인해 주세요.");
    return hit.id;
  };
  const chatConnections = {
    codef: () => bank.clear(),
    toss: () => (store.clearInvestments(), toss.clear()),
    gmail: () => mail.remove("gmail"),
    naver: () => mail.remove("naver"),
    ai: () => ai.clear(),
    codex: () => ai.codex.logout(),
    claude: () => ai.claude.logout(),
  };
  app.post("/api/proposals/:id/apply", async (req) => {
    const proposal = store.overview().messages?.find((m) => m.id === req.params.id)?.proposal;
    store.applyProposal(req.params.id);
    try {
      for (const c of proposal?.changes || []) {
        if (c.type === "connection") {
          if (c.target === "bank_quick") c.remove ? bank.removeQuick(quickByName(c.name)) : bank.renameQuick(quickByName(c.name), c.alias);
          else await chatConnections[c.target]();
        } else if (c.type === "run") await chatRuns[c.task](proposal.month);
        else if (c.type === "mail_send") {
          const sent = await mail.send({ provider: c.provider, to: c.to, subject: c.subject, text: c.body });
          // a cancellation or refund request: the subscription it's about is now followed until it ends
          const item = c.subscription && store.overview().subscriptions.items.find((i) => i.name.replace(/\s/g, "") === c.subscription.replace(/\s/g, ""));
          if (item) store.noteCancelMail(item.key, sent);
        }
      }
    } catch (e) {
      // nothing stored? then it can simply be tried again; otherwise say what did happen
      if (proposal.changes.every((c) => c.type === "run" || c.type === "connection" || c.type === "mail_send")) {
        store.reopenProposal(req.params.id);
        throw e;
      }
      // two lines, each a fixed sentence, so the screen can show both in either language
      throw Error(`변경은 저장됐지만 실행은 끝내지 못했습니다.
${/[가-힣]/.test(e.message) ? e.message : "잠시 뒤 다시 시도해 주세요."}`);
    }
    // new interview answers change the style analysis (what you said vs what the account shows)
    if (proposal?.changes.some((c) => c.type === "interview") && toss.status().ready) invest.buildProfile().catch(() => {});
    return store.overview(proposal?.month);
  });
  app.post("/api/proposals/:id/preview", async (req) =>
    store.refreshProposal(req.params.id),
  );
  const autoSync = createAutoSync({
    store,
    bank,
    toss,
    notifier,
    afterSync: () => scheduleReview(),
  });
  const ticker = autoReview
    ? setInterval(() => {
        autoSync.tick();
        invest.tick();
        remindSubscriptions();
      }, 60_000)
    : null;
  ticker?.unref();
  app.get("/api/autosync", async () => ({ ...autoSync.settings(), last: autoSync.last() }));
  app.post("/api/autosync", async (req) => ({
    ...autoSync.configure(autoSyncSettingsSchema.parse(req.body)),
    last: autoSync.last(),
  }));
  // a year of card history, for subscriptions that bill yearly or every few weeks
  app.post("/api/subscriptions/deep-scan", async () => {
    await autoSync.run("deep");
    return store.overview();
  });
  app.post("/api/autosync/run", async () => ({
    ...autoSync.settings(),
    last: (await autoSync.run("manual")) ?? autoSync.last(),
  }));
  // Polled while an analysis runs so the progress panel survives moving between tabs.
  app.get("/api/ai-status", async () => {
    const s = ai.status();
    return {
      ...s,
      lastReviewAt: store.overview(s.reviewMonth || undefined).aiReview?.at || null,
    };
  });
  // The server writes verdict sentences and asks the model to answer, so it needs the language too.
  app.post("/api/language", async (req) => {
    const { lang } = z.object({ lang: z.enum(["ko", "en"]) }).strict().parse(req.body);
    store.setSetting("lang", lang);
    return { lang };
  });
  app.get("/api/notifications", async () => notifier.settings());
  // this browser/phone asks to get alerts: its push subscription (only the vendors' push services are accepted)
  app.get("/api/push", async () => push.status());
  app.post("/api/push/subscribe", async (req) => push.subscribe(req.body));
  app.delete("/api/push/devices/:id", async (req) => push.remove(req.params.id));
  app.post("/api/notifications", async (req) =>
    notifier.configure(notificationSettingsSchema.parse(req.body)),
  );
  app.post("/api/notifications/test", async () => notifier.test());
  app.get("/api/mcp-config", async () => ({
    mcpServers: {
      finance: {
        command: process.execPath,
        args: [resolve(root, "server/mcp.js")],
        env: {
          FINANCE_DB: store.databasePath,
        },
      },
    },
  }));
  // Dev mode hands unknown paths to Vite; everywhere else an unknown path gets a sentence, not Fastify's own text.
  if (!(serveUI && dev))
    app.setNotFoundHandler((req, reply) =>
      reply.code(404).send({ error: "요청한 경로가 없습니다." }),
    );
  let vite;
  if (serveUI) {
    if (dev) {
      vite = await (
        await import("vite")
      ).createServer({
        configFile: resolve(root, "vite.config.js"),
        server: { middlewareMode: true },
      });
      app.setNotFoundHandler((req, reply) => {
        for (const [name, value] of Object.entries(reply.getHeaders()))
          reply.raw.setHeader(name, value);
        reply.hijack();
        vite.middlewares(req.raw, reply.raw, () => {
          reply.raw.statusCode = 404;
          reply.raw.end();
        });
      });
    } else
      await app.register(staticPlugin, {
        root: resolve(root, "dist"),
        index: "index.html",
        dotfiles: "deny",
        cacheControl: false,
      });
  }
  app.addHook("onClose", async () => {
    if (ticker) clearInterval(ticker);
    await vite?.close();
    ai.close();
    store.close();
  });
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const app = await buildServer({ dev: process.argv.includes("--dev") });
  await app.listen({
    host: "127.0.0.1",
    port: Number(process.env.PORT) || 4317,
  });
  console.log(
    "개인 재무 에이전트: http://127.0.0.1:" +
      (Number(process.env.PORT) || 4317),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => app.close().then(() => process.exit(0)));
}
