import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { privateRoot } from "./store.js";

export function claudeCli(env = process.env) {
  const configured = env.FINANCE_CLAUDE_PATH;
  const npmEntry = join(
    env.APPDATA || "",
    "npm/node_modules/@anthropic-ai/claude-code/cli.js",
  );
  let desktopEntry;
  if (!configured && env.APPDATA) {
    const directory = join(env.APPDATA, "Claude", "claude-code");
    try {
      desktopEntry = readdirSync(directory, { withFileTypes: true })
        .filter((item) => item.isDirectory() && /^\d+\.\d+\.\d+$/.test(item.name))
        .sort((a, b) => b.name.localeCompare(a.name, "en", { numeric: true }))
        .map((item) => join(directory, item.name, "claude.exe"))
        .find(existsSync);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code))
        throw Error("Claude 앱의 실행 도구 위치를 읽지 못했습니다. 파일 접근 권한을 확인하세요.");
    }
  }
  const nativeEntry = join(env.USERPROFILE || homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  const entry = configured || desktopEntry || (existsSync(nativeEntry) ? nativeEntry : existsSync(npmEntry) ? npmEntry : "claude");
  const source = configured ? "configured" : desktopEntry ? "desktop" : "cli";
  return entry.endsWith(".js")
    ? { command: process.execPath, prefix: [entry], source }
    : { command: entry, prefix: [], source };
}

function run(args, { input = "", detached = false, timeout = 300000, responseId = null } = {}) {
  const { command, prefix } = claudeCli();
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
    let stdout = "", received = false;
    // Same limit as Codex: a stuck CLI must not leave the analysis "running" forever.
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("분석 시간이 초과됐습니다. 거래가 많으면 다시 분석을 눌러 남은 거래를 이어서 처리하세요."));
    }, timeout);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    if (responseId) createInterface({ input: child.stdout }).on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type !== "control_response" || message.response?.request_id !== responseId) return;
      received = true;
      clearTimeout(timer);
      resolveRun(line);
      child.kill();
    });
    child.stderr.on("data", () => {}); // Never expose OAuth or provider diagnostics to the UI.
    child.once("error", (error) => {
      clearTimeout(timer);
      error.notFound = error.code === "ENOENT";
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (received) return;
      if (code === 0) return resolveRun(stdout);
      try { parseClaudeResult(stdout); } catch (error) {
        if (error.code === "AI_QUOTA") return reject(error);
      }
      reject(Object.assign(Error("Claude Code 요청이 실패했습니다. 로그인·사용 한도를 확인하세요. 유료 API로 자동 전환하지 않았습니다."), { code }));
    });
    if (responseId) child.stdin.write(input);
    else if (input) child.stdin.end(input);
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
    '{"mcpServers":{}}',
    "--max-turns",
    "3",
  ];
}

export function parseClaudeResult(raw) {
  const result = JSON.parse(raw);
  if (result.is_error) {
    const quota = result.api_error_status === 429 || result.error === "rate_limit" || /usage limit|rate.?limit|hit your (?:usage )?limit|too many requests/i.test(result.result || "");
    throw Object.assign(Error(quota
      ? "Claude 구독 사용 한도에 도달했습니다. 한도가 복구된 뒤 다시 요청하세요. 유료 API로 자동 전환하지 않았습니다."
      : "Claude Code 요청이 실패했습니다. 로그인·사용 한도를 확인하세요."), quota ? { code: "AI_QUOTA", retryAt: (result.resetsAt || result.rate_limit_info?.resetsAt) * 1000 } : {});
  }
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
        source: claudeCli().source,
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
    if (status.connected) return status;
    await this.runner(["auth", "login"], { detached: true });
    return { ...status, started: true };
  }
  async logout() {
    const status = await this.status();
    if (!status.installed) return status;
    await this.runner(["auth", "logout"]);
    return { installed: true, connected: false, authMethod: null };
  }
  async models() {
    const responseId = "finance-models";
    const raw = await this.runner([
      "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--safe-mode", "--no-session-persistence", "--no-chrome", "--permission-mode", "dontAsk",
      "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    ], {
      input: JSON.stringify({ type: "control_request", request_id: responseId, request: { subtype: "initialize", hooks: null } }) + "\n",
      responseId,
      timeout: 30000,
    }).catch((error) => {
      if (error.notFound) throw Error("Claude 앱의 Code 탭을 한 번 열거나 Claude Code를 설치한 뒤 모델 목록을 새로고침하세요.");
      throw error;
    });
    const result = JSON.parse(raw).response;
    if (result?.subtype !== "success" || !Array.isArray(result.response?.models))
      throw Error("Claude 모델 목록을 가져오지 못했습니다. 설치·로그인 상태를 확인하세요.");
    return result.response.models.map((model) => ({ value: model.value, label: model.displayName }));
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
