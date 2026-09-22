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

export async function buildServer({
  store = createStore(),
  ai = createAI(store),
  bank = null,
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
  const app = Fastify({
    logger: false,
    bodyLimit: 2_000_000,
    requestTimeout: 200000,
  });
  const token = randomBytes(32).toString("hex");
  function scheduleReview(month) {
    if (!autoReview || ai.status().busy) return;
    const s = store.overview(month),
      r = s.aiReview;
    if (
      (!s.transactions.length && !s.bankTransactions.length) ||
      (!r.stale && r.status === "error") ||
      (!r.stale && r.status === "complete" && !r.pendingCount)
    )
      return;
    void ai.review(s.analysis.month).catch(() => {});
  }
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host || "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      return reply
        .code(403)
        .send({ error: "로컬 호스트에서만 접근할 수 있습니다." });
    const origin = req.headers.origin;
    if (origin && origin !== "http://" + host)
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
        ? "입력 형식·금액·날짜를 확인하세요."
        : code === 404
          ? "요청한 경로가 없습니다."
          : code === 403
            ? "접근할 수 없는 경로입니다."
            : code === 413
              ? "2MB 이하 파일을 가져오세요."
              : err.message;
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
  app.post("/api/analysis", async (req) => {
    const p = z.object({ month: monthSchema }).strict().parse(req.body);
    return ai.review(p.month, { force: true });
  });
  app.get("/api/connection", async () => ai.status());
  app.post("/api/connection", async (req) => {
    if (
      !connectionModels[req.body?.provider]?.some(
        ({ value }) => value === req.body.model,
      )
    )
      throw Error("목록에 있는 AI 모델을 선택하세요.");
    const result = ai.configure(req.body);
    if (autoReview)
      void ai
        .review(store.overview().analysis.month, { force: true })
        .catch(() => {});
    return result;
  });
  app.delete("/api/connection", async () => ai.clear());
  app.post("/api/codex/status", async () => ai.codex.status());
  app.post("/api/codex/login", async () => ai.codex.login());
  app.post("/api/codex/logout", async () => ai.codex.logout());
  app.post("/api/chat", async (req) => {
    const p = z
      .object({ message: z.string().min(1).max(4000), month: monthSchema })
      .strict()
      .parse(req.body);
    return ai.chat(p.message, p.month);
  });
  app.post("/api/proposals/:id/apply", async (req) =>
    store.applyProposal(req.params.id),
  );
  app.post("/api/proposals/:id/preview", async (req) =>
    store.refreshProposal(req.params.id),
  );
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
