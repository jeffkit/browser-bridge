/**
 * 端到端冒烟：起 gateway serve 进程 → 假扩展 WS 接入 → 经 MCP streamable HTTP
 * 调 browser_status / browser_tab_list / browser_navigate（--allow-url 拦截）。
 *
 * 前置：pnpm build（需要 packages/gateway/dist）。
 * 运行：node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const TOKEN = "smoke-token";
const CLI = new URL("../packages/gateway/dist/cli.js", import.meta.url).pathname;

const child = spawn(process.execPath, [CLI, "serve", "--port", "0", "--host", "127.0.0.1", "--token", TOKEN, "--allow-url", "^https://example\\.com/"], {
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
child.stderr.on("data", (c) => {
  stderr += c.toString();
});

function fail(msg) {
  console.error(`✗ ${msg}\n--- gateway stderr ---\n${stderr}`);
  child.kill();
  process.exit(1);
}

// 从日志提取随机端口
let port = null;
for (let i = 0; i < 100 && port === null; i++) {
  const m = stderr.match(/监听 ws:\/\/[^:]+:(\d+)/);
  if (m) port = Number(m[1]);
  await sleep(100);
}
if (!port) fail("未从 gateway 日志解析到端口");
console.log(`✓ gateway 已启动 :${port}`);

// --- 假扩展 ---
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
ws.addEventListener("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      proto: 1,
      auth: TOKEN,
      client: { name: "fake-extension", version: "0.0.1" },
    }),
  );
});
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.type !== "request") return;
  const reply = (ok, payload) => ws.send(JSON.stringify({ type: "result", id: msg.id, ok, ...payload }));
  if (msg.method === "tabs.list") {
    reply(true, {
      result: {
        tabs: [{ id: 1, windowId: 1, title: "Smoke Tab", url: "https://example.com/", active: true }],
      },
    });
  } else if (msg.method === "tabs.navigate") {
    if (msg.params.url === "https://example.com/smoke") {
      reply(true, { result: { tabId: 1, url: msg.params.url, title: "Navigated", status: "complete" } });
    } else {
      reply(false, { error: { code: "unexpected_url", message: msg.params.url } });
    }
  } else {
    reply(false, { error: { code: "method_not_found", message: `假扩展未实现 ${msg.method}` } });
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
console.log("✓ 假扩展已接入");

// --- MCP streamable HTTP ---
const base = `http://127.0.0.1:${port}`;
const post = async (body, sessionId) => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id"),
    body: dataLine ? JSON.parse(dataLine.slice(5).trim()) : text ? JSON.parse(text) : null,
  };
};

const init = await post({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
});
if (init.status !== 200 || !init.sessionId) fail(`initialize 失败：${init.status}`);
const sid = init.sessionId;
await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);
console.log("✓ MCP initialize 完成");

const call = async (name, args, id) => {
  const r = await post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, sid);
  const result = r.body?.result ?? {};
  return { isError: result.isError === true, text: result.content?.[0]?.text ?? "", result };
};

const status = await call("browser_status", {}, 2);
if (status.isError || JSON.parse(status.text).connected !== true) fail(`browser_status 异常：${status.text}`);
console.log("✓ browser_status：扩展在线");

const tabs = await call("browser_tab_list", {}, 3);
if (tabs.isError) fail(`browser_tab_list 报错：${tabs.text}`);
const tabsJson = JSON.parse(tabs.text);
if (tabsJson.tabs?.[0]?.title !== "Smoke Tab") fail(`tabs 数据不符：${tabs.text}`);
console.log("✓ browser_tab_list：经扩展往返成功");

const nav = await call("browser_navigate", { url: "https://example.com/smoke" }, 4);
if (nav.isError || JSON.parse(nav.text).status !== "complete") fail(`browser_navigate 异常：${nav.text}`);
console.log("✓ browser_navigate：allow-url 内放行");

const blocked = await call("browser_navigate", { url: "https://evil.example.org/" }, 5);
if (!blocked.isError || !blocked.text.includes("url_not_allowed")) fail(`allow-url 拦截失效：${blocked.text}`);
console.log("✓ browser_navigate：allow-url 外被拦截");

const health = await fetch(`${base}/healthz`);
if ((await health.json()).connected !== true) fail("healthz 未报告扩展在线");
console.log("✓ healthz 正常");

ws.close();
child.kill();
console.log("\n冒烟通过 ✓");
process.exit(0);
