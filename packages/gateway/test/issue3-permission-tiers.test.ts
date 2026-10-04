/**
 * Issue #3 回归测试：动作面最小权限档。
 *
 * 断言来自验收条目「档位在 hub/mcp tools 层强制生效」：
 *  - 默认（未传 permission）= 最窄档：browser_evaluate 与 page.click|fill|type|press 返回 permission_denied，而非放行；
 *  - 显式 --permission full：上述动作放行（反向对照，防过度收紧）；
 *  - 非本会话创建的既有 tabId：默认拒绝（owner 校验 → tab_not_owned）；
 *  - 页面内容带不可信标记（snapshot delimiter + untrusted: true）。
 *
 * 导航兜底校验（点链接/表单/JS 跳转绕开 --allow-url 的参数入口）由扩展侧 nav-guard 承担，
 * 单测见 `test/nav-guard.test.ts`；gateway ↔ 扩展的 allowlist 下发与 nav_blocked 上报见 `test/hub.test.ts`。
 */
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BrowserHub } from "../src/hub.js";
import { TOOLS } from "../src/mcp/tools.js";
import type { GatewayConfig, Permission } from "../src/config.js";
import { openWs, sendHello, TOKEN, waitUntil } from "./helpers.js";

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (stops.length) await stops.pop()!();
});

/** 起 hub + 假扩展（对任何请求都回 ok）。 */
async function startHub(opts: { permission?: Permission; allowUrls?: RegExp[] } = {}) {
  const config: GatewayConfig = {
    port: 0,
    host: "127.0.0.1",
    allowedTokens: [TOKEN],
    allowUrls: opts.allowUrls ?? [],
    ...(opts.permission !== undefined ? { permission: opts.permission } : {}),
  };
  const hub = new BrowserHub({ config });
  await hub.start();
  stops.push(() => hub.stop());
  const ws = await openWs(hub.address.port);
  sendHello(ws);
  await waitUntil(() => hub.getSession() !== null);
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as { type: string; id?: string };
    if (msg.type !== "request" || !msg.id) return;
    ws.send(
      JSON.stringify({
        type: "result",
        id: msg.id,
        ok: true,
        result: { tabId: 1, url: "https://example.com/", title: "t", text: "", nodes: [], value: 42 },
      }),
    );
  });
  return { hub, ws };
}

async function callTool(
  hub: BrowserHub,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ denied: boolean; code?: string; message?: string; value?: unknown }> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new Error(`未知工具：${name}`);
  try {
    const value = await def.handler(args, { hub, browserId: "default" });
    return { denied: false, value };
  } catch (err) {
    return { denied: true, code: (err as { code?: string }).code, message: String(err) };
  }
}

describe("Issue #3 权限档", () => {
  it("默认最窄档：browser_evaluate 被拒且错误码明确", async () => {
    const { hub } = await startHub();
    const r = await callTool(hub, "browser_evaluate", { fn: "() => document.title" });
    expect(r.denied, "默认档下 browser_evaluate 不应放行").toBe(true);
    expect(r.code).toBe("permission_denied");
  });

  it("read-only 档：page.click|fill|type|press 全部被拒", async () => {
    const { hub } = await startHub({ permission: "read-only" });
    const cases: Array<[string, Record<string, unknown>]> = [
      ["browser_click", { ref: "@e1" }],
      ["browser_fill", { ref: "@e2", value: "x" }],
      ["browser_type", { ref: "@e2", text: "x" }],
      ["browser_press", { key: "Enter" }],
    ];
    for (const [name, args] of cases) {
      const r = await callTool(hub, name, args);
      expect(r.denied, `read-only 档下 ${name} 不应放行`).toBe(true);
      expect(r.code, `read-only 档下 ${name} 的错误码`).toBe("permission_denied");
    }
  });

  it("full 档：evaluate / snapshot 放行，且页面内容带不可信标记", async () => {
    const { hub } = await startHub({ permission: "full" });

    // 先 navigate 一次：该 tab 成为本会话 owner，后续带 tabId 的调用才放行
    const nav = await callTool(hub, "browser_navigate", { url: "https://example.com/" });
    expect(nav.denied).toBe(false);
    expect((nav.value as { tabId?: number }).tabId).toBe(1);

    const evaluate = await callTool(hub, "browser_evaluate", { fn: "() => 42", tabId: 1 });
    expect(evaluate.denied, "full 档下 browser_evaluate 应放行").toBe(false);
    expect((evaluate.value as { untrusted?: boolean }).untrusted).toBe(true);

    const snapshot = await callTool(hub, "browser_snapshot", { tabId: 1 });
    const snapValue = snapshot.value as { untrusted?: boolean; text?: string };
    expect(snapshot.denied, "本会话 navigate/create 过的 tabId 应放行").toBe(false);
    expect(snapValue.untrusted).toBe(true);
    expect(snapValue.text).toContain("<untrusted-page-content>");
  });

  it("非本会话创建的既有 tabId：默认拒绝（owner 校验）", async () => {
    const { hub } = await startHub({ permission: "full" });
    const snapshot = await callTool(hub, "browser_snapshot", { tabId: 7 });
    const evaluate = await callTool(hub, "browser_evaluate", { fn: "() => 1", tabId: 7 });
    expect(snapshot.denied, "未显式开启时不得读取非本会话创建的 tab").toBe(true);
    expect(snapshot.code).toBe("tab_not_owned");
    expect(evaluate.denied, "未显式开启时不得在非本会话创建的 tab 上执行 JS").toBe(true);
    expect(evaluate.code).toBe("tab_not_owned");
  });

  it("navigate-allowlist 档：navigate 越界仍返回 url_not_allowed（既有行为，防回归）", async () => {
    const { hub } = await startHub({
      permission: "navigate-allowlist",
      allowUrls: [/^https:\/\/example\.com\//],
    });
    const r = await callTool(hub, "browser_navigate", { url: "https://evil.example/" });
    expect(r.denied).toBe(true);
    expect(r.code).toBe("url_not_allowed");
  });
});
