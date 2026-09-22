import { z } from "zod";
import { spawn } from "node:child_process";
import { platform } from "node:os";

export const notificationSettingsSchema = z
  .object({
    desktop: z.boolean().default(true),
    ntfyTopic: z.string().trim().max(64).regex(/^[A-Za-z0-9_-]*$/, "영문·숫자·-·_만 쓸 수 있습니다.").default(""),
    ntfyServer: z.string().trim().url().max(200).or(z.literal("")).default(""),
  })
  .strict();
const APP = "알아서";
const xml = (s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const run = (cmd, args, input) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
    if (input) p.stdin.write(input);
    p.stdin.end();
  });
// OS notification center on the machine running the server. No dependency; each platform's built-in tool.
export function desktopNotify(title, body, exec = run) {
  const os = platform();
  if (os === "win32") {
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual></toast>')
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show((New-Object Windows.UI.Notifications.ToastNotification $x))`;
    return exec("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
  }
  if (os === "darwin") {
    const q = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return exec("osascript", ["-e", `display notification "${q(body)}" with title "${q(title)}"`]);
  }
  return exec("notify-send", [title, body]);
}

export function createNotifier(store, { fetcher = fetch, exec = run } = {}) {
  const settings = () => notificationSettingsSchema.parse(store.getSetting("notifications", {}));
  async function send(title, body) {
    const s = settings(),
      results = {};
    if (s.desktop) results.desktop = await desktopNotify(title, body, exec);
    if (s.ntfyTopic) {
      const server = s.ntfyServer || "https://ntfy.sh";
      results.ntfy = await fetcher(server, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: s.ntfyTopic, title, message: body, tags: ["moneybag"] }),
      })
        .then((r) => r.ok)
        .catch(() => false);
    }
    return results;
  }
  // One notification per transaction verdict; a re-analysis of the same data stays quiet.
  async function reviewCompleted(report) {
    if (report?.status !== "complete") return;
    const seen = store.getSetting("notified", {}),
      fresh = report.largeExpenses.filter((t) => t.advice?.text && seen[t.key] !== t.advice.text);
    if (!fresh.length) return;
    fresh.forEach((t) => (seen[t.key] = t.advice.text));
    store.setSetting("notified", seen);
    const lines = fresh.slice(0, 3).map((t) => `${t.merchant} ${new Intl.NumberFormat("ko-KR").format(t.amount)}원 → ${t.advice.text}`);
    if (fresh.length > 3) lines.push(`외 ${fresh.length - 3}건`);
    return send(`${APP} · 살펴볼 결제 ${fresh.length}건`, lines.join("\n"));
  }
  async function reviewFailed(message, basis) {
    if (store.getSetting("notifiedFailure") === basis) return;
    store.setSetting("notifiedFailure", basis);
    return send(`${APP} · 자동 분석 실패`, message);
  }
  return {
    settings,
    configure: (input) => {
      const s = notificationSettingsSchema.parse(input);
      store.setSetting("notifications", s);
      return s;
    },
    send,
    test: () => send(APP, "알림이 이렇게 옵니다. 일단 써. 나머진 알아서."),
    reviewCompleted,
    reviewFailed,
  };
}
