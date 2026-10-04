/**
 * relay token ↔ browserId 绑定（issue #2）：跨用户顶替 / 离线任意 token 建会话 / body 期间槽位易主。
 */
import { spawn, type ChildProcess } from "node:child_process";
import http, { type IncomingMessage } from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BrowserHub } from "../src/hub.js";
import { bearerToken, createStreamableHttpHandler } from "../src/mcp/http.js";
import { createMcpServer } from "../src/mcp/server.js";
import { openWs, sendHello, waitUntil } from "./helpers.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
const HOME = "home";
const LAPTOP = "laptop";
const TOKEN_HOME = "tok-home-1234";
const TOKEN_LAPTOP = "tok-laptop-1234";
const MAPPING = [`${HOME}=${TOKEN_HOME}`, `${LAPTOP}=${TOKEN_LAPTOP}`];

interface JsonRpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "scope-test", version: "0" },
  },
};

const children: ChildProcess[] = [];
const hubs: BrowserHub[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  while (sockets.length) sockets.pop()!.close();
  while (hubs.length) await hubs.pop()!.stop();
  while (children.length) children.pop()!.kill();
  await sleep(50);
});

/** args 为 `--token` 的取值（`<browserId>=<token>`），逐个以 `--token` 传入。 */
function spawnRelay(args: string[]): { child: ChildProcess; stderr: () => string } {
  const child = spawn(
    process.execPath,
    [CLI, "relay", "--port", "0", "--host", "127.0.0.1", ...args.flatMap((a) => ["--token", a])],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));
  children.push(child);
  return { child, stderr: () => stderr };
}

async function startRelay(args: string[]): Promise<{ port: number; stderr: () => string }> {
  const { child, stderr } = spawnRelay(args);
  for (let i = 0; i < 50; i++) {
    const m = /监听 ws:\/\/[^:]+:(\d+)/.exec(stderr());
    if (m) return { port: Number(m[1]), stderr };
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  throw new Error(`relay 未启动（exit=${child.exitCode}）：${stderr()}`);
}

async function connect(
  port: number,
  token: string,
  browserId: string,
): Promise<{ ws: WebSocket; closed: Promise<number | null> }> {
  const ws = await openWs(port);
  sockets.push(ws);
  const closed = new Promise<number | null>((resolve) => ws.on("close", (code) => resolve(code)));
  sendHello(ws, token, browserId);
  return { ws, closed };
}

/** 在 ms 内未关闭即返回 "pending"（连接被接受）。 */
function settled<T>(p: Promise<T>, ms: number): Promise<T | "pending"> {
  return Promise.race([p, sleep(ms).then(() => "pending" as const)]);
}

async function mcpPost(
  port: number,
  body: Record<string, unknown>,
  opts: { path?: string; bearer?: string; sessionId?: string } = {},
): Promise<{ status: number; sessionId?: string; body: JsonRpcResponse | null }> {
  const res = await fetch(`http://127.0.0.1:${port}${opts.path ?? "/mcp"}`, {
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
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  const parsed = dataLine
    ? (JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse)
    : text
      ? (JSON.parse(text) as JsonRpcResponse)
      : null;
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id") ?? undefined,
    body: parsed,
  };
}

/** 分两半上传 body：中途执行 duringUpload，用于构造「鉴权 → dispatch」窗口。 */
function slowInitialize(
  port: number,
  urlPath: string,
  bearer: string,
  duringUpload: () => Promise<void>,
): Promise<{ status: number; sessionId?: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(INIT);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(body),
          authorization: `Bearer ${bearer}`,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            sessionId:
              typeof res.headers["mcp-session-id"] === "string"
                ? res.headers["mcp-session-id"]
                : undefined,
          }),
        );
      },
    );
    req.on("error", reject);
    const half = Math.floor(body.length / 2);
    req.write(body.slice(0, half));
    setTimeout(() => {
      duringUpload().then(
        () => req.end(body.slice(half)),
        (err) => reject(err),
      );
    }, 200);
  });
}

describe("relay：token ↔ browserId 绑定（issue #2）", () => {
  it("hello 的 token 不属于 hello.browserId → 4003", async () => {
    const { port } = await startRelay(MAPPING);
    const { closed } = await connect(port, TOKEN_HOME, LAPTOP);
    expect(await settled(closed, 2000)).toBe(4003);
  });

  it("token 与 browserId 匹配 → 连接保持在线", async () => {
    const { port } = await startRelay(MAPPING);
    const { ws, closed } = await connect(port, TOKEN_HOME, HOME);
    expect(await settled(closed, 600)).toBe("pending");
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it("他人 token 顶替已在线 browserId → 4003，且原连接不被踢", async () => {
    const { port } = await startRelay(MAPPING);
    const first = await connect(port, TOKEN_HOME, HOME);
    expect(await settled(first.closed, 600)).toBe("pending");

    const hijack = await connect(port, TOKEN_LAPTOP, HOME);
    expect(await settled(hijack.closed, 2000)).toBe(4003);
    expect(await settled(first.closed, 300)).toBe("pending");
    expect(first.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("同 browserId + 同 token 重连 → 顶替旧连接（1000）", async () => {
    const { port } = await startRelay(MAPPING);
    const first = await connect(port, TOKEN_HOME, HOME);
    expect(await settled(first.closed, 600)).toBe("pending");

    const second = await connect(port, TOKEN_HOME, HOME);
    expect(await settled(first.closed, 2000)).toBe(1000);
    expect(await settled(second.closed, 300)).toBe("pending");
  });

  it("浏览器离线时 /mcp/<browserId> 只认映射中该 browserId 的 token", async () => {
    const { port } = await startRelay(MAPPING);

    const otherToken = await mcpPost(port, INIT, { path: `/mcp/${LAPTOP}`, bearer: TOKEN_HOME });
    expect(otherToken.status).toBe(401);

    const ownToken = await mcpPost(port, INIT, { path: `/mcp/${LAPTOP}`, bearer: TOKEN_LAPTOP });
    expect(ownToken.status).toBe(200);
    expect(ownToken.sessionId).toBeTruthy();

    const crossed = await mcpPost(port, INIT, { path: `/mcp/${HOME}`, bearer: TOKEN_LAPTOP });
    expect(crossed.status).toBe(401);
  });

  it("browser_status 的 browsers 只含调用方 token 绑定的 browserId", async () => {
    const { port } = await startRelay(MAPPING);
    const home = await connect(port, TOKEN_HOME, HOME);
    const laptop = await connect(port, TOKEN_LAPTOP, LAPTOP);
    expect(await settled(home.closed, 600)).toBe("pending");
    expect(await settled(laptop.closed, 600)).toBe("pending");

    const init = await mcpPost(port, INIT, { path: `/mcp/${HOME}`, bearer: TOKEN_HOME });
    expect(init.status).toBe(200);
    const sid = init.sessionId;
    expect(sid).toBeTruthy();
    await mcpPost(
      port,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { path: `/mcp/${HOME}`, bearer: TOKEN_HOME, sessionId: sid },
    );

    const status = await mcpPost(
      port,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "browser_status", arguments: {} },
      },
      { path: `/mcp/${HOME}`, bearer: TOKEN_HOME, sessionId: sid },
    );
    const text = (status.body?.result?.content as Array<{ text?: string }>)[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { browsers?: Array<{ browserId: string }> };
    expect(parsed.browsers?.map((b) => b.browserId)).toEqual([HOME]);
  });

  it("--token 映射的格式/唯一性非法 → 启动失败（非零退出）", async () => {
    for (const args of [
      [`${HOME}=${TOKEN_HOME}`, `${HOME}=other-token`],
      [`${HOME}=${TOKEN_HOME}`, `${LAPTOP}=${TOKEN_HOME}`],
      ["bad id=x-token"],
      [`${HOME}=`],
    ]) {
      const { child, stderr } = spawnRelay(args);
      const outcome = await Promise.race([
        new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? -1))),
        sleep(3000).then(() => "running" as const),
      ]);
      expect(outcome, `args=${JSON.stringify(args)} 应被拒绝：${stderr()}`).not.toBe("running");
      if (typeof outcome === "number") expect(outcome).toBeGreaterThan(0);
    }
  });
});

describe("hub / MCP：槽位归属与鉴权时序（issue #2）", () => {
  it("hub 层：不同 token 不能顶替同 browserId 的在线连接", async () => {
    const hub = new BrowserHub({
      config: {
        port: 0,
        host: "127.0.0.1",
        allowedTokens: [TOKEN_HOME, TOKEN_LAPTOP],
        allowUrls: [],
      },
    });
    await hub.start();
    hubs.push(hub);

    const first = await connect(hub.address.port, TOKEN_HOME, HOME);
    expect(await settled(first.closed, 600)).toBe("pending");

    const hijack = await connect(hub.address.port, TOKEN_LAPTOP, HOME);
    expect(await settled(hijack.closed, 2000)).toBe(4003);
    expect(await settled(first.closed, 300)).toBe("pending");
    expect(hub.getSession(HOME)?.token).toBe(TOKEN_HOME);
  });

  it("慢速上传：body 读完后再验一次槽位归属，期间被他人占用即不放行", async () => {
    const tokens = [TOKEN_HOME, TOKEN_LAPTOP];
    const registry = new Set(tokens);
    let hub: BrowserHub;
    const authenticate = (req: IncomingMessage, browserId: string): boolean => {
      const bearer = bearerToken(req);
      if (!bearer || !registry.has(bearer)) return false;
      const session = hub.getSession(browserId);
      return session ? bearer === session.token : true;
    };
    hub = new BrowserHub({
      config: { port: 0, host: "127.0.0.1", allowedTokens: tokens, allowUrls: [] },
      httpHandler: createStreamableHttpHandler((browserId) => createMcpServer(hub, browserId), {
        authenticate,
      }),
    });
    await hub.start();
    hubs.push(hub);

    const res = await slowInitialize(hub.address.port, `/mcp/${LAPTOP}`, TOKEN_HOME, async () => {
      const taken = await connect(hub.address.port, TOKEN_LAPTOP, LAPTOP);
      await waitUntil(() => hub.getSession(LAPTOP) !== null);
      expect(await settled(taken.closed, 300)).toBe("pending");
    });

    expect(res.status).toBe(401);
    expect(res.sessionId).toBeUndefined();
  });
});
