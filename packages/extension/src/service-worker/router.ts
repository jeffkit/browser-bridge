import { type TabInfo, type WaitFor } from "@browser-bridge/protocol";

/** 带错误码的业务失败（Connection 会转成 result.error）。 */
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tabInfo(tab: chrome.tabs.Tab): TabInfo {
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: tab.active ?? false,
  };
}

async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (typeof tabId === "number") {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      fail("tab_not_found", `tab ${tabId} 不存在或已关闭`);
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || typeof tab.id !== "number") {
    fail("tab_not_found", "找不到活跃标签页");
  }
  return tab;
}

// ---------- tabs.* ----------

async function navigate(p: {
  url: string;
  tabId?: number;
  waitFor?: WaitFor;
  timeoutMs?: number;
}): Promise<unknown> {
  const tab = await resolveTab(p.tabId);
  const tabId = tab.id as number;
  await chrome.tabs.update(tabId, { url: p.url });

  const waitFor = p.waitFor ?? "load";
  if (waitFor === "none") {
    return { tabId, url: p.url, title: tab.title ?? "", status: "complete" };
  }

  const timeoutMs = Math.min(Number(p.timeoutMs) || 15_000, 60_000);
  // 等导航开始信号（首个 onUpdated），避免轮询打在旧页面上；导航极快错过信号也只多等一小段
  await Promise.race([
    new Promise<void>((resolve) => {
      const listener = (id: number): void => {
        if (id === tabId) {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(resolve, 800);
    }),
  ]);

  // 轮询 readyState：受限页面（chrome:// 等）注入失败返回 null，视为继续等
  const deadline = Date.now() + timeoutMs;
  let reached = false;
  while (Date.now() < deadline) {
    const ready = await pageReadyState(tabId);
    if (ready === "complete" || (waitFor === "domcontentloaded" && ready === "interactive")) {
      reached = true;
      break;
    }
    await sleep(200);
  }

  let title = tab.title ?? "";
  try {
    const after = await chrome.tabs.get(tabId);
    title = after.title ?? title;
  } catch {
    fail("tab_not_found", `导航过程中 tab ${tabId} 被关闭`);
  }
  return { tabId, url: p.url, title, status: reached ? "complete" : "timeout" };
}

async function pageReadyState(tabId: number): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.readyState,
    });
    return (results[0]?.result as string) ?? null;
  } catch {
    return null;
  }
}

async function screenshot(p: { tabId?: number; jpegQuality?: number }): Promise<unknown> {
  const tab = await resolveTab(p.tabId);
  const tabId = tab.id as number;
  if (!tab.active) {
    await chrome.tabs.update(tabId, { active: true });
    await sleep(300);
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: p.jpegQuality != null ? "jpeg" : "png",
      quality: p.jpegQuality != null ? Math.min(100, Math.max(0, p.jpegQuality)) : undefined,
    });
    return { tabId, dataUrl };
  } catch (err) {
    fail("screenshot_failed", `截图失败：${msg(err)}`);
  }
}

// ---------- page.*（经 content script） ----------

interface ContentResponse {
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

async function sendToTab(tabId: number, message: unknown): Promise<ContentResponse> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as ContentResponse;
  } catch (err) {
    fail("page_not_injectable", `页面通信失败（可能未注入或页面受限）：${msg(err)}`);
  }
}

async function ensureInjected(tabId: number): Promise<void> {
  const probe = await chrome.tabs.sendMessage(tabId, { type: "bb-probe" }).catch(() => null);
  if (probe && (probe as { injected?: boolean }).injected) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (err) {
    fail("page_not_injectable", `无法注入脚本（chrome:// 等受限页面不支持）：${msg(err)}`);
  }
}

async function pageCall(
  tabIdParam: number | undefined,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const tab = await resolveTab(tabIdParam);
  const tabId = tab.id as number;
  await ensureInjected(tabId);
  const resp = await sendToTab(tabId, { type: "bb-request", method, params });
  if (!resp || typeof resp !== "object") {
    fail("page_action_failed", "content script 无响应");
  }
  if (resp.ok) {
    // 协议要求 snapshot 结果带 tabId；content script 侧不知道
    if (method === "page.snapshot" && resp.result && typeof resp.result === "object") {
      return { tabId: tab.id, ...(resp.result as Record<string, unknown>) };
    }
    return resp.result;
  }
  fail(resp.error?.code ?? "page_action_failed", resp.error?.message ?? "页面操作失败");
}

/** page.evaluate 不走 content script：SW 直接 executeScript，支持 MAIN world。 */
async function evaluate(p: {
  fn: string;
  args?: unknown[];
  world?: "ISOLATED" | "MAIN";
  tabId?: number;
}): Promise<unknown> {
  const tab = await resolveTab(p.tabId);
  const tabId = tab.id as number;
  let fn: (...args: unknown[]) => unknown;
  try {
    const parsed = new Function(`return (${p.fn})`)();
    if (typeof parsed !== "function") throw new Error("fn 必须是函数表达式");
    fn = parsed as (...args: unknown[]) => unknown;
  } catch (err) {
    fail("bad_params", `fn 非法：${msg(err)}`);
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: p.world === "MAIN" ? "MAIN" : "ISOLATED",
      func: fn,
      args: (p.args ?? []) as never[],
    });
    return { value: results[0]?.result };
  } catch (err) {
    fail("evaluate_failed", `页面脚本执行失败：${msg(err)}`);
  }
}

// ---------- 分发 ----------

export async function dispatch(method: string, rawParams: unknown): Promise<unknown> {
  const params = (rawParams ?? {}) as Record<string, unknown>;
  switch (method) {
    case "ping":
      return { pong: true, echo: params.echo, ts: Date.now() };
    case "tabs.list": {
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.filter((t) => typeof t.id === "number" && t.id >= 0).map(tabInfo) };
    }
    case "tabs.get":
      return { tab: tabInfo(await resolveTab(params.tabId as number)) };
    case "tabs.create": {
      const tab = await chrome.tabs.create({
        url: params.url as string | undefined,
        active: (params.active as boolean | undefined) ?? true,
      });
      return { tab: tabInfo(tab) };
    }
    case "tabs.close":
      await chrome.tabs.remove(params.tabId as number);
      return { closed: true };
    case "tabs.activate": {
      const tabId = params.tabId as number;
      await chrome.tabs.update(tabId, { active: true });
      return { tab: tabInfo(await chrome.tabs.get(tabId)) };
    }
    case "tabs.navigate":
      return navigate(params as never);
    case "tabs.screenshot":
      return screenshot(params as never);
    case "page.snapshot":
      return pageCall(params.tabId as number | undefined, method, params);
    case "page.click":
      return pageCall(params.tabId as number | undefined, method, params);
    case "page.fill":
      return pageCall(params.tabId as number | undefined, method, params);
    case "page.type":
      return pageCall(params.tabId as number | undefined, method, params);
    case "page.press":
      return pageCall(params.tabId as number | undefined, method, params);
    case "page.scroll":
      return pageCall(params.tabId as number | undefined, method, params);
    case "page.evaluate":
      return evaluate(
        params as unknown as { fn: string; args?: unknown[]; world?: "ISOLATED" | "MAIN"; tabId?: number },
      );
    default:
      fail("method_not_found", `未知方法：${method}`);
  }
}
