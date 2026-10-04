/**
 * 扩展侧导航兜底守卫单测（Issue #3）：--allow-url 的参数入口之外，
 * 点链接 / 表单提交 / JS 跳转由扩展在 tabs.onUpdated 上兜底。
 *
 * 直接驱动扩展源码：注入假 globalThis.chrome（api.ts 适配层读取它），
 * 动态 import nav-guard.ts，再手动触发 onUpdated 监听器。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavBlockedInfo } from "../../extension/src/service-worker/nav-guard.js";

interface TabChange {
  tabId: number;
  changeInfo: { url?: string };
  tab: { url?: string };
}

const listeners: Array<(tabId: number, changeInfo: { url?: string }, tab: { url?: string }) => void> = [];
const updates: Array<{ tabId: number; props: { url?: string } }> = [];

async function freshGuard() {
  vi.resetModules();
  listeners.length = 0;
  updates.length = 0;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      onUpdated: {
        addListener: (fn: (tabId: number, changeInfo: { url?: string }, tab: { url?: string }) => void) =>
          listeners.push(fn),
      },
      update: (tabId: number, props: { url?: string }) => {
        updates.push({ tabId, props });
        return Promise.resolve({ id: tabId, url: props.url });
      },
    },
  };
  const mod = await import("../../extension/src/service-worker/nav-guard.js");
  const blocked: NavBlockedInfo[] = [];
  mod.navGuard.onBlocked = (info) => blocked.push(info);
  mod.navGuard.install();
  return { navGuard: mod.navGuard, blocked };
}

/** 触发 tabs.onUpdated（扩展从 changeInfo.url ?? tab.url 取 URL）。 */
async function fireNavigation(change: TabChange): Promise<void> {
  for (const listener of listeners) listener(change.tabId, change.changeInfo, change.tab);
  await Promise.resolve();
}

const ALLOW = /^https:\/\/example\.com\//;

describe("扩展导航兜底守卫（nav-guard）", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("owned tab 上的非白名单导航 → 回退到上一个允许 URL 并上报 url_not_allowed", async () => {
    const { navGuard, blocked } = await freshGuard();
    navGuard.setAllowlist([ALLOW.source]);
    navGuard.trackOwnedTab(5);
    navGuard.noteAllowedUrl(5, "https://example.com/a");

    await fireNavigation({ tabId: 5, changeInfo: { url: "https://evil.example.org/" }, tab: { url: "https://evil.example.org/" } });

    expect(updates).toEqual([{ tabId: 5, props: { url: "https://example.com/a" } }]);
    expect(blocked).toEqual([
      { tabId: 5, url: "https://evil.example.org/", from: "https://example.com/a", code: "url_not_allowed" },
    ]);
  });

  it("白名单内的导航 → 不动作，且成为新的回退目标", async () => {
    const { navGuard, blocked } = await freshGuard();
    navGuard.setAllowlist([ALLOW.source]);
    navGuard.trackOwnedTab(5);
    navGuard.noteAllowedUrl(5, "https://example.com/a");

    await fireNavigation({ tabId: 5, changeInfo: {}, tab: { url: "https://example.com/b" } });
    expect(updates).toEqual([]);
    expect(blocked).toEqual([]);

    // 新允许页已成为回退目标
    await fireNavigation({ tabId: 5, changeInfo: { url: "https://evil.example.org/" }, tab: {} });
    expect(updates).toEqual([{ tabId: 5, props: { url: "https://example.com/b" } }]);
  });

  it("非 owned tab（用户自己的标签页）→ 不动作", async () => {
    const { navGuard, blocked } = await freshGuard();
    navGuard.setAllowlist([ALLOW.source]);

    await fireNavigation({ tabId: 9, changeInfo: { url: "https://evil.example.org/" }, tab: {} });
    expect(updates).toEqual([]);
    expect(blocked).toEqual([]);
  });

  it("未下发允许列表（setAllowlist([])）→ 不动作", async () => {
    const { navGuard, blocked } = await freshGuard();
    navGuard.setAllowlist([]);
    navGuard.trackOwnedTab(5);

    await fireNavigation({ tabId: 5, changeInfo: { url: "https://evil.example.org/" }, tab: {} });
    expect(updates).toEqual([]);
    expect(blocked).toEqual([]);
  });

  it("没有历史允许 URL → 回退 about:blank", async () => {
    const { navGuard, blocked } = await freshGuard();
    navGuard.setAllowlist([ALLOW.source]);
    navGuard.trackOwnedTab(5);

    await fireNavigation({ tabId: 5, changeInfo: { url: "https://evil.example.org/" }, tab: {} });
    expect(updates).toEqual([{ tabId: 5, props: { url: "about:blank" } }]);
    expect(blocked[0]?.from).toBeUndefined();
  });
});
