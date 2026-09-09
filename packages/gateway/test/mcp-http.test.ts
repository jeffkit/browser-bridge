import { afterEach, describe, expect, it } from "vitest";
import { BrowserHub } from "../src/hub.js";
import { createStreamableHttpHandler } from "../src/mcp/http.js";
import { createMcpServer } from "../src/mcp/server.js";
import { TOKEN } from "./helpers.js";

interface JsonRpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function startHub(): Promise<BrowserHub> {
  const hub: BrowserHub = new BrowserHub({
    config: { port: 0, host: "127.0.0.1", token: TOKEN, allowUrls: [] },
    httpHandler: createStreamableHttpHandler(() => createMcpServer(hub)),
  });
  await hub.start();
  return hub;
}

/** POST 一条 JSON-RPC；SDK 默认以 SSE 返回，提取 data: 行的 JSON。 */
async function post(
  base: string,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ status: number; headers: Record<string, string>; body: JsonRpcResponse | null }> {
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
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  let parsed: JsonRpcResponse | null = null;
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  if (dataLine) parsed = JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse;
  else if (text) parsed = JSON.parse(text) as JsonRpcResponse;
  return { status: res.status, headers, body: parsed };
}

describe("MCP streamable HTTP 入口", () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()!();
  });

  it("initialize → tools/list → 离线时 browser_status 可用、tab_list 报错", async () => {
    const hub = await startHub();
    stops.push(() => hub.stop());
    const base = `http://127.0.0.1:${hub.address.port}`;

    const init = await post(base, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-agent", version: "0.0.1" },
      },
    });
    expect(init.status).toBe(200);
    const sessionId = init.headers["mcp-session-id"];
    expect(sessionId).toBeTruthy();
    expect(init.body?.result?.serverInfo).toMatchObject({ name: "browser-bridge-gateway" });

    // initialized 通知（无 id，可能 202 无 body）
    await post(base, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);

    const list = await post(base, { jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionId);
    expect(list.status).toBe(200);
    const tools = list.body?.result?.tools as Array<{ name: string }>;
    const names = tools.map((t) => t.name);
    for (const expected of [
      "browser_status",
      "browser_tab_list",
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_fill",
      "browser_evaluate",
      "browser_screenshot",
    ]) {
      expect(names).toContain(expected);
    }

    const status = await post(base, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_status", arguments: {} } }, sessionId);
    const statusText = (status.body?.result?.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(status.body?.result?.isError).toBeUndefined();
    expect(JSON.parse(statusText)).toMatchObject({ connected: false });

    const tabList = await post(base, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "browser_tab_list", arguments: {} } }, sessionId);
    expect(tabList.body?.result?.isError).toBe(true);
    const errText = (tabList.body?.result?.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(errText).toContain("browser_disconnected");
  });

  it("无会话头的非 initialize POST → 400；未知会话 → 404", async () => {
    const hub = await startHub();
    stops.push(() => hub.stop());
    const base = `http://127.0.0.1:${hub.address.port}`;

    const noInit = await post(base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(noInit.status).toBe(400);

    const unknown = await post(base, { jsonrpc: "2.0", id: 2, method: "tools/list" }, "bogus-session");
    expect(unknown.status).toBe(404);
  });

  it("healthz 报告连接状态", async () => {
    const hub = await startHub();
    stops.push(() => hub.stop());
    const res = await fetch(`http://127.0.0.1:${hub.address.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, connected: false });
  });
});
