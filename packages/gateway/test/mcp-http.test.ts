import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BrowserHub } from "../src/hub.js";
import { bearerToken, createStreamableHttpHandler } from "../src/mcp/http.js";
import { createMcpServer } from "../src/mcp/server.js";
import { openWs, sendHello, TOKEN, waitUntil } from "./helpers.js";
import type { IncomingMessage } from "node:http";

interface JsonRpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function startHub(authenticate?: (req: IncomingMessage, browserId: string) => boolean): Promise<BrowserHub> {
  const hub: BrowserHub = new BrowserHub({
    config: { port: 0, host: "127.0.0.1", allowedTokens: [TOKEN], allowUrls: [] },
    httpHandler: createStreamableHttpHandler((browserId) => createMcpServer(hub, browserId), {
      authenticate,
    }),
  });
  await hub.start();
  return hub;
}

/** POST 一条 JSON-RPC；SDK 默认以 SSE 返回，提取 data: 行的 JSON。 */
async function post(
  base: string,
  body: Record<string, unknown>,
  opts: { sessionId?: string; path?: string; bearer?: string } = {},
): Promise<{ status: number; headers: Record<string, string>; body: JsonRpcResponse | null }> {
  const res = await fetch(`${base}${opts.path ?? "/mcp"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(opts.sessionId ? { "mcp-session-id": opts.sessionId } : {}),
      ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
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

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-agent", version: "0.0.1" },
  },
};

describe("MCP streamable HTTP 入口", () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()!();
  });

  it("initialize → tools/list → 离线时 browser_status 可用、tab_list 报错", async () => {
    const hub = await startHub();
    stops.push(() => hub.stop());
    const base = `http://127.0.0.1:${hub.address.port}`;

    const init = await post(base, INIT);
    expect(init.status).toBe(200);
    const sessionId = init.headers["mcp-session-id"];
    expect(sessionId).toBeTruthy();
    expect(init.body?.result?.serverInfo).toMatchObject({ name: "browser-bridge-gateway" });

    // initialized 通知（无 id，可能 202 无 body）
    await post(base, { jsonrpc: "2.0", method: "notifications/initialized" }, { sessionId });

    const list = await post(base, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId });
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

    const status = await post(base, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_status", arguments: {} } }, { sessionId });
    const statusText = (status.body?.result?.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(status.body?.result?.isError).toBeUndefined();
    expect(JSON.parse(statusText)).toMatchObject({ connected: false, browserId: "default" });

    const tabList = await post(base, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "browser_tab_list", arguments: {} } }, { sessionId });
    expect(tabList.body?.result?.isError).toBe(true);
    const errText = (tabList.body?.result?.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(errText).toContain("browser_disconnected");
  });

  it("/mcp/:browserId 绑定对应浏览器并正确路由请求", async () => {
    const hub = await startHub();
    stops.push(() => hub.stop());
    const base = `http://127.0.0.1:${hub.address.port}`;

    // 假扩展接入 browserId=laptop，独立应答
    const ws = await openWs(hub.address.port);
    sendHello(ws, TOKEN, "laptop");
    await waitUntil(() => hub.getSession("laptop") !== null);
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as { type: string; id?: string };
      if (msg.type === "request") {
        ws.send(
          JSON.stringify({
            type: "result",
            id: msg.id,
            ok: true,
            result: { tabs: [{ id: 7, title: "Laptop Tab" }] },
          }),
        );
      }
    });

    const init = await post(base, INIT, { path: "/mcp/laptop" });
    expect(init.status).toBe(200);
    const sid = init.headers["mcp-session-id"];
    await post(base, { jsonrpc: "2.0", method: "notifications/initialized" }, { sessionId: sid, path: "/mcp/laptop" });

    const status = await post(
      base,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "browser_status", arguments: {} } },
      { sessionId: sid, path: "/mcp/laptop" },
    );
    const statusJson = JSON.parse((status.body?.result?.content as Array<{ text?: string }>)[0]?.text ?? "{}");
    expect(statusJson).toMatchObject({ connected: true, browserId: "laptop" });

    const tabs = await post(
      base,
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_tab_list", arguments: {} } },
      { sessionId: sid, path: "/mcp/laptop" },
    );
    const tabsJson = JSON.parse((tabs.body?.result?.content as Array<{ text?: string }>)[0]?.text ?? "{}");
    expect(tabsJson.tabs?.[0]?.title).toBe("Laptop Tab");

    // 非法 browserId → 400
    const bad = await post(base, INIT, { path: "/mcp/..%2Fevil" });
    expect(bad.status).toBe(400);
    ws.close();
  });

  it("authenticate 拒绝无/错 Bearer（401），放行正确 Bearer", async () => {
    const hub = await startHub((req) => bearerToken(req) === "good-token");
    stops.push(() => hub.stop());
    const base = `http://127.0.0.1:${hub.address.port}`;

    const noAuth = await post(base, INIT);
    expect(noAuth.status).toBe(401);

    const badAuth = await post(base, INIT, { bearer: "wrong" });
    expect(badAuth.status).toBe(401);

    const ok = await post(base, INIT, { bearer: "good-token" });
    expect(ok.status).toBe(200);
    expect(ok.headers["mcp-session-id"]).toBeTruthy();
  });

  it("无会话头的非 initialize POST → 400；未知会话 → 404", async () => {
    const hub = await startHub();
    stops.push(() => hub.stop());
    const base = `http://127.0.0.1:${hub.address.port}`;

    const noInit = await post(base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(noInit.status).toBe(400);

    const unknown = await post(base, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId: "bogus-session" });
    expect(unknown.status).toBe(404);
  });

  it("healthz 报告在线浏览器数", async () => {
    const hub = await startHub();
    stops.push(() => hub.stop());
    const res = await fetch(`http://127.0.0.1:${hub.address.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, browsers: 0 });

    const ws = await openWs(hub.address.port);
    sendHello(ws, TOKEN, "laptop");
    await waitUntil(() => hub.getSession("laptop") !== null);
    const res2 = await fetch(`http://127.0.0.1:${hub.address.port}/healthz`);
    expect(await res2.json()).toEqual({ ok: true, browsers: 1 });
    ws.close();
  });
});
