import { describe, expect, it } from "vitest";
import { BrowserHub } from "../src/hub.js";
import { openWs, recvJson, sendHello, TOKEN, waitUntil } from "./helpers.js";

async function startHub(allowUrls: RegExp[] = []): Promise<BrowserHub> {
  const hub = new BrowserHub({
    config: { port: 0, host: "127.0.0.1", allowedTokens: [TOKEN], allowUrls },
  });
  await hub.start();
  return hub;
}

describe("BrowserHub 扩展接入", () => {
  it("token 错误 → 4003 拒绝", async () => {
    const hub = await startHub();
    try {
      const ws = await openWs(hub.address.port);
      sendHello(ws, "wrong-token");
      const code = await new Promise<number>((resolve) => ws.on("close", (c) => resolve(c)));
      expect(code).toBe(4003);
    } finally {
      await hub.stop();
    }
  });

  it("首条消息不是 hello → 拒绝", async () => {
    const hub = await startHub();
    try {
      const ws = await openWs(hub.address.port);
      ws.send(JSON.stringify({ type: "ping" }));
      const code = await new Promise<number>((resolve) => ws.on("close", (c) => resolve(c)));
      expect(code).toBe(4001);
    } finally {
      await hub.stop();
    }
  });

  it("hello 后 request/response 往返", async () => {
    const hub = await startHub();
    try {
      const ws = await openWs(hub.address.port);
      sendHello(ws);
      await waitUntil(() => hub.getSession() !== null);
      expect(hub.getSession()?.client).toEqual({ name: "fake-extension", version: "0.0.1" });

      const pending = hub.getSession()!.request("tabs.list", {}, 3000);
      const req = await recvJson(ws, "request");
      expect(req.method).toBe("tabs.list");
      ws.send(JSON.stringify({ type: "result", id: req.id, ok: true, result: { tabs: [{ id: 1 }] } }));
      await expect(pending).resolves.toEqual({ tabs: [{ id: 1 }] });
    } finally {
      await hub.stop();
    }
  });

  it("扩展回错误 → reject 携带错误码", async () => {
    const hub = await startHub();
    try {
      const ws = await openWs(hub.address.port);
      sendHello(ws);
      await waitUntil(() => hub.getSession() !== null);

      const pending = hub.getSession()!.request("page.click", { ref: "@e1" }, 3000);
      const req = await recvJson(ws, "request");
      ws.send(
        JSON.stringify({
          type: "result",
          id: req.id,
          ok: false,
          error: { code: "stale_ref", message: "ref 过期" },
        }),
      );
      await expect(pending).rejects.toMatchObject({ code: "stale_ref" });
    } finally {
      await hub.stop();
    }
  });

  it("扩展不回包 → 超时 reject", async () => {
    const hub = await startHub();
    try {
      const ws = await openWs(hub.address.port);
      sendHello(ws);
      await waitUntil(() => hub.getSession() !== null);

      await expect(hub.getSession()!.request("page.snapshot", {}, 100)).rejects.toMatchObject({
        code: "timeout",
      });
    } finally {
      await hub.stop();
    }
  });

  it("扩展断开 → pending 请求 reject browser_disconnected，session 清空", async () => {
    const hub = await startHub();
    try {
      const ws = await openWs(hub.address.port);
      sendHello(ws);
      await waitUntil(() => hub.getSession() !== null);

      const pending = hub.getSession()!.request("tabs.list", {}, 5000);
      ws.close();
      await expect(pending).rejects.toMatchObject({ code: "browser_disconnected" });
      await waitUntil(() => hub.getSession() === null);
    } finally {
      await hub.stop();
    }
  });

  it("新连接顶替旧连接", async () => {
    const hub = await startHub();
    try {
      const ws1 = await openWs(hub.address.port);
      sendHello(ws1);
      await waitUntil(() => hub.getSession() !== null);
      const first = hub.getSession()!;

      // 监听必须先于顶替动作注册：close 事件可能在 waitUntil 轮询期间就触发
      const codePromise = new Promise<number>((resolve) => ws1.on("close", (c) => resolve(c)));

      const ws2 = await openWs(hub.address.port);
      sendHello(ws2);
      await waitUntil(() => hub.getSession() !== null && hub.getSession()!.id !== first.id);

      expect(await codePromise).toBe(1000);
      expect(hub.getSession()?.id).not.toBe(first.id);
      ws2.close();
    } finally {
      await hub.stop();
    }
  });

  it("非法 browserId → 4004 拒绝", async () => {
    const hub = await startHub();
    try {
      const ws = await openWs(hub.address.port);
      sendHello(ws, TOKEN, "../evil");
      const code = await new Promise<number>((resolve) => ws.on("close", (c) => resolve(c)));
      expect(code).toBe(4004);
    } finally {
      await hub.stop();
    }
  });

  it("多浏览器：不同 browserId 并存且请求路由到对应浏览器", async () => {
    const hub = await startHub();
    try {
      const wsA = await openWs(hub.address.port);
      sendHello(wsA, TOKEN, "laptop");
      const wsB = await openWs(hub.address.port);
      sendHello(wsB, TOKEN, "phone");
      await waitUntil(() => hub.getSession("laptop") !== null && hub.getSession("phone") !== null);

      expect(hub.listBrowsers().map((b) => b.browserId).sort()).toEqual(["laptop", "phone"]);

      const pA = hub.getSession("laptop")!.request("tabs.list", {}, 3000);
      const reqA = await recvJson(wsA, "request");
      wsA.send(JSON.stringify({ type: "result", id: reqA.id, ok: true, result: { tabs: "A" } }));
      await expect(pA).resolves.toEqual({ tabs: "A" });

      // B 不应收到 A 的请求；B 自己的请求独立往返
      const pB = hub.getSession("phone")!.request("tabs.list", {}, 3000);
      const reqB = await recvJson(wsB, "request");
      wsB.send(JSON.stringify({ type: "result", id: reqB.id, ok: true, result: { tabs: "B" } }));
      await expect(pB).resolves.toEqual({ tabs: "B" });
    } finally {
      await hub.stop();
    }
  });

  it("同一 browserId 的新连接顶替，不影响其他 browserId", async () => {
    const hub = await startHub();
    try {
      const wsL1 = await openWs(hub.address.port);
      sendHello(wsL1, TOKEN, "laptop");
      const wsP = await openWs(hub.address.port);
      sendHello(wsP, TOKEN, "phone");
      await waitUntil(
        () => hub.getSession("laptop") !== null && hub.getSession("phone") !== null,
      );
      const firstLaptop = hub.getSession("laptop")!;
      const codePromise = new Promise<number>((resolve) => wsL1.on("close", (c) => resolve(c)));

      const wsL2 = await openWs(hub.address.port);
      sendHello(wsL2, TOKEN, "laptop");
      await waitUntil(() => hub.getSession("laptop")!.id !== firstLaptop.id);

      expect(await codePromise).toBe(1000);
      expect(hub.getSession("phone")).not.toBeNull();
      wsL2.close();
      wsP.close();
    } finally {
      await hub.stop();
    }
  });

  it("ping → pong 心跳", async () => {
    const hub = await startHub();
    try {
      const ws = await openWs(hub.address.port);
      sendHello(ws);
      await waitUntil(() => hub.getSession() !== null);

      ws.send(JSON.stringify({ type: "ping" }));
      const pong = await recvJson(ws, "pong");
      expect(pong.type).toBe("pong");
    } finally {
      await hub.stop();
    }
  });

  it("checkUrl：未配置全放行，配置后只放匹配项", async () => {
    const hub = await startHub();
    expect(hub.checkUrl("https://example.com")).toBe(true);
    await hub.stop();

    const hub2 = await startHub([/^https:\/\/example\.com\//]);
    expect(hub2.checkUrl("https://example.com/a")).toBe(true);
    expect(hub2.checkUrl("https://evil.com/")).toBe(false);
    await hub2.stop();
  });
});
