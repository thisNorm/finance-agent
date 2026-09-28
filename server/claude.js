import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { privateRoot } from "./store.js";

function cli() {
  const configured = process.env.FINANCE_CLAUDE_PATH;
  const npmEntry = join(
    process.env.APPDATA || "",
    "npm/node_modules/@anthropic-ai/claude-code/cli.js",
  );
  const entry = configured || (existsSync(npmEntry) ? npmEntry : "claude");
  return entry.endsWith(".js")
    ? { command: process.execPath, prefix: [entry] }
    : { command: entry, prefix: [] };
}

function run(args, { input = "", detached = false, timeout = 300000 } = {}) {
  const { command, prefix } = cli();
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, [...prefix, ...args], {
      cwd: resolve(privateRoot, "agent-work"),
      windowsHide: !detached,
      detached,
      stdio: detached ? "ignore" : ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    });
    if (detached) {
      child.once("error", reject);
      child.unref();
      return resolveRun("");
    }
    let stdout = "";
    // Same limit as Codex: a stuck CLI must not leave the analysis "running" forever.
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("분석 시간이 초과됐습니다. 거래가 많으면 다시 분석을 눌러 남은 거래를 이어서 처리하세요."));
    }, timeout);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", () => {}); // Never expose OAuth or provider diagnostics to the UI.
    child.once("error", (error) => {
      clearTimeout(timer);
      error.notFound = error.code === "ENOENT";
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolveRun(stdout)
        : reject(Object.assign(Error("Claude Code 요청이 실패했습니다. 로그인·사용 한도를 확인하세요. 유료 API로 자동 전환하지 않았습니다."), { code }));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function claudeArgs({ schema, model = "", webSearch = false }) {
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "--model",
    model || "sonnet",
    "--safe-mode",
    "--no-session-persistence",
    "--no-chrome",
    "--permission-mode",
    "dontAsk",
    "--tools",
    webSearch ? "WebSearch" : "",
    "--disallowedTools",
    "mcp__*",
    "--strict-mcp-config",
    "--mcp-config",
    "{}",
    "--max-turns",
    "3",
  ];
}

export function parseClaudeResult(raw) {
  const result = JSON.parse(raw);
  if (result.structured_output)
    return JSON.stringify(result.structured_output);
  if (typeof result.result === "string" && result.result.trim())
    return result.result;
  throw Error("Claude 응답 형식이 맞지 않아 결과를 반영하지 않았습니다.");
}

export class ClaudeConnection {
  constructor(runner = run) {
    this.runner = runner;
    mkdirSync(resolve(privateRoot, "agent-work"), { recursive: true });
  }
  async status() {
    try {
      const result = JSON.parse(
        await this.runner(["auth", "status", "--json"]),
      );
      return {
        installed: true,
        connected: result.loggedIn === true,
        authMethod: result.authMethod || null,
      };
    } catch (error) {
      return {
        installed: !error.notFound,
        connected: false,
        authMethod: null,
      };
    }
  }
  async login() {
    const status = await this.status();
    if (!status.installed)
      throw Error("Claude Code를 설치한 뒤 다시 시도하세요.");
    await this.runner(["auth", "login"], { detached: true });
    return { ...status, started: true };
  }
  async logout() {
    const status = await this.status();
    if (!status.installed) return status;
    await this.runner(["auth", "logout"]);
    return { installed: true, connected: false, authMethod: null };
  }
  async ask(prompt, schema, model, { webSearch = false, onEvent = null } = {}) {
    const status = await this.status();
    if (!status.installed)
      throw Error("Claude Code를 설치한 뒤 대시보드에서 로그인하세요.");
    if (!status.connected)
      throw Error("대시보드에서 Claude 구독 로그인을 먼저 연결하세요.");
    if (webSearch) onEvent?.("webSearch");
    const raw = await this.runner(
      claudeArgs({ schema, model, webSearch }),
      { input: prompt },
    );
    return parseClaudeResult(raw);
  }
  close() {}
}
