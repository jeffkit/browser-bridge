import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BrowserHub } from "../src/hub.js";
import { createStreamableHttpHandler } from "../src/mcp/http.js";
import { createMcpServer } from "../src/mcp/server.js";
import { openWs, sendHello, TOKEN, waitUntil } from "./helpers.js";

const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (stops.length) await stops.pop()!();
});

async function startHubWithFakeBrowser(): Promise<{ hub: BrowserHub; port: number; ws: WebSocket }> {
  const hub: BrowserHub = new BrowserHub({
    config: { port: 0, host: "127.0.0.1", allowedTokens: [TOKEN], allowUrls: [] },
    httpHandler: createStreamableHttpHandler((browserId) => createMcpServer(hub, browserId)),
  });
  await hub.start();
  stops.push(() => hub.stop());
  const ws = await openWs(hub.address.port);
  sendHello(ws, TOKEN, "default");
  await waitUntil(() => hub.getSession("default") !== null);
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as { type: string; id?: string; method?: string };
    if (msg.type !== "request" || !msg.id) return;
    const replyOk = (result: unknown) =>
      ws.send(JSON.stringify({ type: "result", id: msg.id, ok: true, result }));
    if (msg.method === "tabs.list") replyOk({ tabs: [{ id: 3, windowId: 1, title: "Call Test Tab", url: "https://example.com/", active: true }] });
    else if (msg.method === "page.evaluate") replyOk({ value: 42 });
    else if (msg.method === "page.click")
      ws.send(JSON.stringify({ type: "result", id: msg.id, ok: false, error: { code: "stale_ref", message: "ref 过期" } }));
    else replyOk({});
  });
  return { hub, port: hub.address.port, ws };
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe("gateway call 子命令（免常驻 MCP 配置）", () => {
  it("browser_tab_list 经 call 走通并输出扩展数据", async () => {
    const { port, ws } = await startHubWithFakeBrowser();
    const r = await runCli(["call", "browser_tab_list", "--url", `http://127.0.0.1:${port}/mcp`]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.tabs[0]).toMatchObject({ title: "Call Test Tab" });
    ws.close();
  }, 20_000);

  it("--raw 输出结构化结果；isError 时 exit 1", async () => {
    const { port, ws } = await startHubWithFakeBrowser();
    const ok = await runCli(["call", "browser_evaluate", "--args", '{"fn":"() => 42"}', "--url", `http://127.0.0.1:${port}/mcp`, "--raw"]);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout).text[0]).toContain("42");

    const err = await runCli(["call", "browser_click", "--args", '{"ref":"@e99"}', "--url", `http://127.0.0.1:${port}/mcp`]);
    expect(err.code).toBe(1);
    expect(err.stdout).toContain("stale_ref");
    ws.close();
  }, 30_000);

  it("gateway 不可达时报错 exit 1", async () => {
    const r = await runCli(["call", "browser_status", "--url", "http://127.0.0.1:1/mcp", "--timeout", "3"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("调用失败");
  }, 20_000);
});
