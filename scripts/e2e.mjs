/**
 * 真实浏览器 E2E：起 gateway → Playwright 启动本机 Chrome（headed，加载 dist-extension）→
 * 经扩展 service worker 写入配置连上 gateway → MCP 驱动真实页面：
 * 导航 / 快照 @eN / 填表 / 键入 / 点击 / 按键 / 滚动 / 执行 JS / 截图 / 标签页管理 / 失效引用。
 *
 * 前置：pnpm build；本机无 Chrome 时需 pnpm exec playwright install chromium（回退用）。
 * 运行：node scripts/e2e.mjs；无显示环境（CI）用 xvfb-run -a node scripts/e2e.mjs。
 * 环境变量 BB_E2E_CHANNEL 覆盖浏览器渠道（默认优先本机 Chrome，回退 Playwright Chromium）。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const TOKEN = "e2e-token";
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CLI = join(ROOT, "packages/gateway/dist/cli.js");
const EXT = join(ROOT, "packages/extension/dist-extension");

if (!existsSync(CLI) || !existsSync(join(EXT, "manifest.json"))) {
  console.error("✗ 缺构建产物（packages/gateway/dist、packages/extension/dist-extension），先运行 pnpm build");
  process.exit(1);
}

const gw = { proc: null, stderr: "" };
const cleanup = () => {
  gw.proc?.kill();
};
function fail(msg) {
  console.error(`✗ ${msg}\n--- gateway stderr ---\n${gw.stderr}`);
  cleanup();
  process.exit(1);
}

// ---------- 本地测试页 ----------
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>BB E2E</title></head><body>
<h1>BB E2E 测试页</h1>
<p id="out">(empty)</p>
<label for="name">称呼</label><input id="name" placeholder="Your name">
<button id="greet">Greet</button>
<a id="lnk" href="#bottom">锚点链接</a>
<div style="height:2000px">长页面用于滚动</div>
<p id="bottom">页面底部</p>
<script>
  const input = document.getElementById("name");
  const out = document.getElementById("out");
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") out.textContent = "PRESSED:" + input.value; });
  document.getElementById("greet").addEventListener("click", () => { out.textContent = "HELLO:" + input.value; });
</script>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(HTML);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pagePort = server.address().port;
const PAGE_URL = `http://127.0.0.1:${pagePort}/`;

// ---------- gateway serve ----------
gw.proc = spawn(process.execPath, [CLI, "serve", "--port", "0", "--host", "127.0.0.1", "--token", TOKEN], {
  stdio: ["ignore", "ignore", "pipe"],
});
gw.proc.stderr.on("data", (c) => (gw.stderr += c.toString()));

let port = null;
for (let i = 0; i < 100 && port === null; i++) {
  const m = gw.stderr.match(/监听 ws:\/\/[^:]+:(\d+)/);
  if (m) port = Number(m[1]);
  await sleep(100);
}
if (!port) fail("未从 gateway 日志解析到端口");
const base = `http://127.0.0.1:${port}`;
console.log(`✓ gateway 已启动 :${port}`);

// ---------- 启动真实浏览器并加载扩展 ----------
const userDataDir = mkdtempSync(join(tmpdir(), "bb-e2e-"));
// Linux（xvfb 无 GPU）用 swiftshader 软渲染，否则 captureVisibleTab 报 image readback failed
const platformArgs = process.platform === "linux" ? ["--use-angle=swiftshader"] : [];
const launchArgs = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check", ...platformArgs];
// 渠道顺序：默认 Playwright Chromium（品牌版 Chrome 137+ 已移除 --load-extension，不可用），
// 回退本机 Chrome / 默认构建；BB_E2E_CHANNEL 可强制指定
let context = null;
let lastErr = null;
for (const channel of [process.env.BB_E2E_CHANNEL || "chromium", "chrome", undefined]) {
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: channel || undefined,
      args: launchArgs,
    });
    console.log(`✓ 浏览器已启动（${channel ? `channel=${channel}` : "Playwright Chromium"}，扩展已加载）`);
    break;
  } catch (err) {
    lastErr = err;
  }
}
if (!context) fail(`浏览器启动失败：${lastErr}\n提示：本机无 Chrome 时先运行 pnpm exec playwright install chromium`);

// 定位扩展 ID：优先从 CDP 目标列表读 SW URL（channel=chrome 时 Playwright 不上报扩展 SW，
// 但 CDP 能看到）；失败则按未打包扩展 ID 算法从绝对路径推（SHA256 前 16 字节 hex，0-f→a-p）
async function discoverExtId() {
  try {
    const cdp = await context.newBrowserCDPSession();
    for (let i = 0; i < 50; i++) {
      const { targetInfos } = await cdp.send("Target.getTargets");
      const t = targetInfos.find((x) => x.type === "service_worker" && x.url.endsWith("/service-worker.js"));
      if (t) return { id: new URL(t.url).host, via: "cdp" };
      await sleep(200);
    }
  } catch {
    /* 落到路径推导 */
  }
  const { createHash } = await import("node:crypto");
  const hex = createHash("sha256").update(realpathSync(EXT)).digest("hex").slice(0, 32);
  return { id: [...hex].map((c) => String.fromCharCode(parseInt(c, 16) + 97)).join(""), via: "computed" };
}
const ext = await discoverExtId();
const options = await context.newPage();
await options.goto(`chrome-extension://${ext.id}/options.html`, { waitUntil: "load" });
await options.evaluate(
  ({ url, token }) => chrome.storage.local.set({ config: { gatewayUrl: url, token, browserId: "" } }),
  { url: `ws://127.0.0.1:${port}`, token: TOKEN },
);
console.log(`✓ 扩展配置已写入（id=${ext.id.slice(0, 8)}… via=${ext.via}，经 options 页 storage 触发 SW 重连）`);

let browsers = 0;
for (let i = 0; i < 200 && browsers < 1; i++) {
  try {
    browsers = (await (await fetch(`${base}/healthz`)).json()).browsers ?? 0;
  } catch {
    /* gateway 起来前 fetch 可能失败，继续等 */
  }
  if (browsers < 1) await sleep(100);
}
if (browsers < 1) fail("扩展 20s 内未连上 gateway（检查 SW 配置写入与 hello 握手）");
console.log("✓ 真实浏览器扩展已连上 gateway");

// ---------- MCP streamable HTTP ----------
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
  let parsed = null;
  try {
    parsed = dataLine ? JSON.parse(dataLine.slice(5).trim()) : text ? JSON.parse(text) : null;
  } catch {
    /* 保留 null，由上层用 rawText 诊断 */
  }
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id"),
    body: parsed,
    rawText: text.slice(0, 400),
  };
};
const init = await post({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "0" } },
});
if (init.status !== 200 || !init.sessionId) fail(`MCP initialize 失败：${init.status}`);
const sid = init.sessionId;
await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);

let callId = 1;
const call = async (name, args = {}) => {
  const r = await post({ jsonrpc: "2.0", id: callId++, method: "tools/call", params: { name, arguments: args } }, sid);
  const result = r.body?.result ?? {};
  return { isError: result.isError === true, text: result.content?.[0]?.text ?? "", raw: result, status: r.status, rawText: r.rawText };
};
const okOr = (r, label) => {
  if (r.isError) fail(`${label} 异常：${r.text}`);
};
// 调用 → 断言成功 → 解析 JSON 结果
const val = async (name, args, label) => {
  const r = await call(name, args);
  if (r.isError) fail(`${label ?? name} 异常：${r.text}`);
  if (!r.text) fail(`${label ?? name} 返回空响应（HTTP ${r.status}）：${r.rawText}`);
  return JSON.parse(r.text);
};
// 在页面里执行读取脚本并返回 value
const evalVal = async (fn, args, world) => {
  const r = await call("browser_evaluate", { fn, args, world, tabId });
  if (r.isError) fail(`browser_evaluate(${fn.slice(0, 30)}) 异常：${r.text}`);
  return JSON.parse(r.text).value;
};

// ---------- 断言序列 ----------
const statusJson = await val("browser_status");
if (statusJson.connected !== true) fail(`browser_status 未连上：${statusJson.text ?? JSON.stringify(statusJson)}`);
console.log("✓ browser_status：真实浏览器扩展在线");

const navJson = await val("browser_navigate", { url: PAGE_URL });
if (navJson.status !== "complete" || navJson.title !== "BB E2E") fail(`导航结果不符：${JSON.stringify(navJson)}`);
const tabId = navJson.tabId;
console.log(`✓ browser_navigate：真实导航到测试页（tabId=${tabId}）`);

// 快照：从结构化树提取 @eN 引用
const snapJson = await val("browser_snapshot", { tabId });
const collect = (nodes, out) => {
  for (const n of nodes ?? []) {
    if (n.ref) out.push(n);
    collect(n.children, out);
  }
};
const refs = [];
collect(snapJson.nodes, refs);
const byName = (role, name) => refs.find((n) => n.role === role && (n.name ?? "").includes(name));
const inputRef = byName("textbox", "Your name")?.ref;
const greetRef = byName("button", "Greet")?.ref;
const linkRef = byName("link", "锚点链接")?.ref;
if (!inputRef || !greetRef || !linkRef) fail(`快照缺关键引用：input=${inputRef} button=${greetRef} link=${linkRef}\n${snapJson.text}`);
if (!snapJson.text.includes(inputRef) || !snapJson.text.includes(greetRef)) fail("快照文本未渲染 @eN 引用");
console.log(`✓ browser_snapshot：@eN 快照（${refs.length} 个可交互元素，${inputRef}/${greetRef}/${linkRef}）`);

// fill → 替换语义
await val("browser_fill", { ref: inputRef, value: "FILL 测试", tabId });
const got1 = await evalVal("() => String(document.getElementById('name').value)");
if (got1 !== "FILL 测试") fail(`fill 结果不符：got=${JSON.stringify(got1)}`);
console.log("✓ browser_fill：真实输入框已填充");

// type → 逐字符追加语义
await val("browser_type", { ref: inputRef, text: "+typed", tabId });
if ((await evalVal("() => document.getElementById('name').value")) !== "FILL 测试+typed") fail("type 结果不符（应为追加）");
await val("browser_fill", { ref: inputRef, value: "e2e 世界", tabId });
console.log("✓ browser_type：逐字符追加保持 input 事件");

// click → 页面 JS 真实响应
await val("browser_click", { ref: greetRef, tabId });
if ((await evalVal("() => document.getElementById('out').textContent")) !== "HELLO:e2e 世界") fail("点击后页面无响应");
console.log("✓ browser_click：真实点击触发页面 JS");

// press → 合成 keydown 被页面监听
await val("browser_press", { ref: inputRef, key: "Enter", tabId });
if ((await evalVal("() => document.getElementById('out').textContent")) !== "PRESSED:e2e 世界") fail("按键未被页面捕获");
console.log("✓ browser_press：合成键盘事件被页面捕获");

// evaluate：默认 MAIN world（页面上下文）、带参数；ISOLATED 显式调用必须给出 CSP 错误提示
if ((await evalVal("() => document.title")) !== "BB E2E") fail("默认 world evaluate 不符");
if ((await evalVal("(x) => 'len:' + x.length", ["你好"])) !== "len:2") fail("evaluate args 不符");
if ((await evalVal("() => (window.__bbMain = 'main-ok')", undefined, "MAIN")) !== "main-ok") fail("MAIN world evaluate 不符");
const isoErr = await call("browser_evaluate", { fn: "() => document.title", world: "ISOLATED", tabId });
if (!isoErr.isError || !isoErr.text.includes("ISOLATED")) fail(`ISOLATED world 未得到预期错误提示：${isoErr.text}`);
await val("browser_scroll", { direction: "down", amount: 800, tabId });
if (!((await evalVal("() => window.scrollY")) > 0)) fail("滚动未生效");
console.log("✓ browser_evaluate（MAIN 默认 + args + ISOLATED 明确报错）/ browser_scroll：执行与滚动生效");

// 截图（captureVisibleTab）：MCP 返回 image content（base64 PNG）
const shotCall = await call("browser_screenshot", { tabId });
if (shotCall.isError) fail(`browser_screenshot 异常：${shotCall.text}`);
const img = shotCall.raw?.content?.[0];
const png = img?.type === "image" ? (img.data ?? "") : "";
if (!png.startsWith("iVBORw0KGgo") || png.length < 2000) fail(`截图结果异常（len=${png.length}）`);
console.log(`✓ browser_screenshot：PNG 截图（约 ${Math.round((png.length * 3) / 4 / 1024)}KB）`);

// 标签页管理
const openJson = await val("browser_tab_open", { url: `${PAGE_URL}#second`, active: true });
const newTabId = openJson.tab.id;
// tabs.create 返回时导航通常未完成（url 为空），轮询等新 tab 就位
let listUrls = [];
for (let i = 0; i < 50; i++) {
  listUrls = (await val("browser_tab_list")).tabs.map((t) => t.url);
  if (listUrls.includes(`${PAGE_URL}#second`)) break;
  await sleep(200);
}
if (!listUrls.includes(PAGE_URL) || !listUrls.includes(`${PAGE_URL}#second`)) fail(`tab 列表不符：${JSON.stringify(listUrls)}`);
await val("browser_tab_close", { tabId: newTabId });
if ((await val("browser_tab_list")).tabs.some((t) => t.id === newTabId)) fail("tab 关闭未生效");
console.log("✓ browser_tab_open / tab_list / tab_close：标签页管理正常");

// 失效引用：导航后旧 @eN 必须报 stale_ref
await val("browser_navigate", { url: PAGE_URL, tabId });
const staleClick = await call("browser_click", { ref: greetRef, tabId });
if (!staleClick.isError || !staleClick.text.includes("stale_ref")) fail(`旧引用未报 stale_ref：${staleClick.text}`);
console.log("✓ 失效引用：页面跳转后旧 @eN 正确报 stale_ref");

// ---------- 收尾 ----------
await context.close();
rmSync(userDataDir, { recursive: true, force: true });
cleanup();
server.close();
console.log("\n真实浏览器 E2E 通过 ✓");
process.exit(0);
