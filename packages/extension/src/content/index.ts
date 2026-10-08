import { api } from "../common/api.js";
import { takeSnapshot } from "./snapshot.js";
import { doClick, doFill, doPress, doScroll, doType } from "./interact.js";

/**
 * 动态注入的 content script（ISOLATED world）。
 * refs 缓存挂在 window.__browserBridge 上：SPA 内不随导航重建；
 * 真实导航/刷新后随页面销毁自然清空，代次从 snapshotGen=0 重新计。
 * snapshotGen 每次快照 +1，与 ref 的 @s<gen>:e<N> 前缀绑定：
 * 交互时校验代次，旧快照的 ref（即使同序号）一律 stale_ref，杜绝静默错点。
 */
declare global {
  interface Window {
    __browserBridge?: { refs: Map<string, Element>; snapshotGen: number };
  }
}

const ctx: { refs: Map<string, Element>; snapshotGen: number } = (window.__browserBridge ??= {
  refs: new Map(),
  snapshotGen: 0,
});

interface TabMessage {
  type: string;
  method?: string;
  params?: Record<string, unknown>;
}

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "page.snapshot": {
      const gen = ++ctx.snapshotGen;
      return takeSnapshot(ctx.refs, gen);
    }
    case "page.click":
      return doClick(ctx.refs, ctx.snapshotGen, String(params.ref));
    case "page.fill":
      return doFill(ctx.refs, ctx.snapshotGen, String(params.ref), String(params.value ?? ""));
    case "page.type":
      return doType(ctx.refs, ctx.snapshotGen, String(params.ref), String(params.text ?? ""));
    case "page.press":
      return doPress(
        ctx.refs,
        ctx.snapshotGen,
        String(params.key),
        params.ref !== undefined ? String(params.ref) : undefined,
      );
    case "page.scroll":
      return doScroll(
        ctx.refs,
        ctx.snapshotGen,
        (params.direction as "up" | "down" | "left" | "right") ?? "down",
        Number(params.amount) || 600,
        params.ref !== undefined ? String(params.ref) : undefined,
      );
    default:
      throw Object.assign(new Error(`未知页面方法：${method}`), { code: "method_not_found" });
  }
}

api.runtime.onMessage.addListener((msg: TabMessage, _sender, sendResponse) => {
  if (msg.type === "bb-probe") {
    sendResponse({ injected: true });
    return false;
  }
  if (msg.type === "bb-request" && typeof msg.method === "string") {
    void handle(msg.method, msg.params ?? {}).then(
      (result) => sendResponse({ ok: true, result }),
      (err) =>
        sendResponse({
          ok: false,
          error: { code: (err as { code?: string })?.code ?? "page_action_failed", message: err instanceof Error ? err.message : String(err) },
        }),
    );
    return true; // 保持消息通道开放直到异步应答
  }
  return false;
});
