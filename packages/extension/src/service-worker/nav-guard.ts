import { api } from "../common/api.js";

/** 被兜底拦截的导航（回传给 gateway 上报）。 */
export interface NavBlockedInfo {
  tabId: number;
  url: string;
  from?: string;
  code: "url_not_allowed";
}

/**
 * 导航允许列表兜底：--allow-url 的参数校验只管 navigate/tab_open 的入参，
 * 点链接 / 表单提交 / JS 跳转发生在页面里。gateway 在 hello 后把允许列表下发到这里，
 * 由 tabs.onUpdated（已有 tabs 权限，无需新增）在导航实际发生处拦截：
 * 越界即回退到该 tab 上一个允许的 URL（没有则 about:blank）并上报 gateway。
 *
 * 作用范围刻意收窄：只对 gateway 驱动过（owned）的 tab 生效，且只拦 http(s)；
 * 未收到允许列表（空）时不动作。用户自己开的 tab / 手动导航不受影响。
 */
class NavGuard {
  private allowPatterns: RegExp[] = [];
  private ownedTabs = new Set<number>();
  /** 每个 tab 最近一次允许的 URL，作为回退目标 */
  private lastAllowed = new Map<number, string>();
  private installed = false;
  /** 拦截回调（index.ts 接到 connection.send 上） */
  onBlocked: ((info: NavBlockedInfo) => void) | null = null;

  install(): void {
    if (this.installed) return;
    this.installed = true;
    api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.onUpdated(tabId, changeInfo.url ?? tab.url);
    });
  }

  /** 接收 gateway 下发的允许列表（正则源码）；空数组 = 不限制；非法正则跳过（不影响其余条目）。 */
  setAllowlist(patterns: string[]): void {
    const compiled: RegExp[] = [];
    for (const pattern of patterns ?? []) {
      try {
        compiled.push(new RegExp(pattern));
      } catch {
        /* 非法正则：忽略该条 */
      }
    }
    this.allowPatterns = compiled;
  }

  /** 记为 owned（gateway 创建/导航过的 tab）。 */
  trackOwnedTab(tabId: number): void {
    this.ownedTabs.add(tabId);
  }

  /** 记录该 tab 当前允许的 URL，作为后续越界导航的回退目标。 */
  noteAllowedUrl(tabId: number, url?: string): void {
    if (url) this.lastAllowed.set(tabId, url);
  }

  private onUpdated(tabId: number, url?: string): void {
    if (!url) return;
    if (!this.ownedTabs.has(tabId)) return;
    if (this.allowPatterns.length === 0) return;
    const from = this.lastAllowed.get(tabId);
    if (url === from) return; // 自己回退触发的事件
    if (!/^https?:/i.test(url)) {
      // about:blank / chrome:// 等不作为拦截对象，但仍可作为回退目标
      this.lastAllowed.set(tabId, url);
      return;
    }
    if (this.allowPatterns.some((re) => re.test(url))) {
      this.lastAllowed.set(tabId, url);
      return;
    }
    const target = from ?? "about:blank";
    this.lastAllowed.set(tabId, target);
    void Promise.resolve(api.tabs.update(tabId, { url: target })).catch(() => {
      /* tab 已关闭等：忽略 */
    });
    this.onBlocked?.({ tabId, url, ...(from !== undefined ? { from } : {}), code: "url_not_allowed" });
  }
}

export const navGuard = new NavGuard();
