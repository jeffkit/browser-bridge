import { takeSnapshot } from "./snapshot.js";
import { doClick, doFill, doPress, doScroll, doType } from "./interact.js";

/**
 * 动态注入的 content script（ISOLATED world）。
 * 每次导航随页面重建，@eN 引用缓存自然清空。
 */
declare global {
  interface Window {
    __browserBridge?: { refs: Map<string, Element> };
  }
}

const ctx: { refs: Map<string, Element> } = (window.__browserBridge ??= { refs: new Map() });

interface TabMessage {
  type: string;
  method?: string;
  params?: Record<string, unknown>;
}

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "page.snapshot":
      return takeSnapshot(ctx.refs);
    case "page.click":
      return doClick(ctx.refs, String(params.ref));
    case "page.fill":
      return doFill(ctx.refs, String(params.ref), String(params.value ?? ""));
    case "page.type":
      return doType(ctx.refs, String(params.ref), String(params.text ?? ""));
    case "page.press":
      return doPress(ctx.refs, String(params.key), params.ref !== undefined ? String(params.ref) : undefined);
    case "page.scroll":
      return doScroll(
        ctx.refs,
        (params.direction as "up" | "down" | "left" | "right") ?? "down",
        Number(params.amount) || 600,
        params.ref !== undefined ? String(params.ref) : undefined,
      );
    default:
      throw Object.assign(new Error(`未知页面方法：${method}`), { code: "method_not_found" });
  }
}

chrome.runtime.onMessage.addListener((msg: TabMessage, _sender, sendResponse) => {
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
