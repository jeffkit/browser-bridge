/**
 * gateway → 扩展 的全部方法与参数/结果类型。
 *
 * 约定：
 * - 所有 `tabId?` 缺省时，扩展端取「最近活跃窗口的 active tab」。
 * - 页面元素用 `@eN` 引用（快照时分配，content script 内缓存），
 *   页面跳转/刷新后缓存清空，旧 ref 返回 stale_ref。
 */

export const Method = {
  Ping: "ping",
  TabsList: "tabs.list",
  TabsGet: "tabs.get",
  TabsCreate: "tabs.create",
  TabsClose: "tabs.close",
  TabsActivate: "tabs.activate",
  TabsNavigate: "tabs.navigate",
  TabsScreenshot: "tabs.screenshot",
  PageSnapshot: "page.snapshot",
  PageClick: "page.click",
  PageFill: "page.fill",
  PageType: "page.type",
  PagePress: "page.press",
  PageScroll: "page.scroll",
  PageEvaluate: "page.evaluate",
} as const;

export type MethodName = (typeof Method)[keyof typeof Method];

/** 各方法默认等待扩展响应的超时（毫秒），gateway 侧使用。 */
export const DefaultTimeoutMs: Record<MethodName, number> = {
  [Method.Ping]: 5_000,
  [Method.TabsList]: 10_000,
  [Method.TabsGet]: 10_000,
  [Method.TabsCreate]: 10_000,
  [Method.TabsClose]: 10_000,
  [Method.TabsActivate]: 10_000,
  [Method.TabsNavigate]: 20_000,
  [Method.TabsScreenshot]: 15_000,
  [Method.PageSnapshot]: 30_000,
  [Method.PageClick]: 15_000,
  [Method.PageFill]: 15_000,
  [Method.PageType]: 15_000,
  [Method.PagePress]: 15_000,
  [Method.PageScroll]: 15_000,
  [Method.PageEvaluate]: 30_000,
};

// ---------- 公共形状 ----------

export interface TabInfo {
  id: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
}

export type WaitFor = "load" | "domcontentloaded" | "none";

export const WaitFors: readonly WaitFor[] = ["load", "domcontentloaded", "none"];

/**
 * 快照节点：树形，序列化时 gateway/agent 侧渲染为缩进文本。
 * `ref` 仅出现在可交互元素上。
 */
export interface SnapshotNode {
  /** @eN 元素引用，可交互元素才有 */
  ref?: string;
  /** 隐式角色：button/link/textbox/checkbox/image/heading/generic/text… */
  role: string;
  /** 可读名：aria-label > 可见文本(截断) > placeholder/alt/value */
  name?: string;
  /** 当前值（textbox 类） */
  value?: string;
  /** 状态标记 */
  checked?: boolean;
  disabled?: boolean;
  focused?: boolean;
  children: SnapshotNode[];
}

export interface PageSnapshotResult {
  tabId: number;
  url: string;
  title: string;
  /** 缩进文本骨架（含 @eN），直接给 LLM 读 */
  text: string;
  /** 结构化树（可选消费） */
  nodes: SnapshotNode[];
}

// ---------- 各方法 params / result ----------

export interface PingParams { echo?: string }
export interface PingResult { pong: true; echo?: string; ts: number }

export interface TabsListParams { /* 无 */ }
export interface TabsListResult { tabs: TabInfo[] }

export interface TabsGetParams { tabId: number }
export interface TabsGetResult { tab: TabInfo }

export interface TabsCreateParams { url?: string; active?: boolean }
export interface TabsCreateResult { tab: TabInfo }

export interface TabsCloseParams { tabId: number }
export interface TabsCloseResult { closed: true }

export interface TabsActivateParams { tabId: number }
export interface TabsActivateResult { tab: TabInfo }

export interface TabsNavigateParams {
  url: string;
  /** 缺省 tabId = active tab */
  tabId?: number;
  /** 等待到什么状态才返回；默认 load */
  waitFor?: WaitFor;
  /** 等待上限毫秒；超时返回 status:"timeout" 而不是报错 */
  timeoutMs?: number;
}
export interface TabsNavigateResult {
  tabId: number;
  url: string;
  title: string;
  status: "complete" | "timeout";
}

export interface TabsScreenshotParams {
  /** 非活跃 tab 会先 activate 再截图；缺省取 active tab */
  tabId?: number;
  /** JPEG 质量 0-100，缺省输出 PNG */
  jpegQuality?: number;
}
export interface TabsScreenshotResult {
  tabId: number;
  /** data:image/png;base64,… 完整 data URL */
  dataUrl: string;
}

export interface PageSnapshotParams { tabId?: number }

export interface PageClickParams { ref: string; tabId?: number }
export interface PageClickResult { clicked: true; ref: string }

export interface PageFillParams { ref: string; value: string; tabId?: number }
export interface PageFillResult { filled: true; ref: string }

export interface PageTypeParams { ref: string; text: string; tabId?: number }
export interface PageTypeResult { typed: true; ref: string }

export interface PagePressParams {
  /** 缺省聚焦 body；key 如 Enter/Tab/Escape/ArrowDown/a（含修饰用 +，如 Control+a） */
  key: string;
  ref?: string;
  tabId?: number;
}
export interface PagePressResult { pressed: true }

export interface PageScrollParams {
  direction: "up" | "down" | "left" | "right";
  /** 像素，缺省 600 */
  amount?: number;
  /** 提供时滚动该元素自身（溢出容器），否则滚动页面 */
  ref?: string;
  tabId?: number;
}
export interface PageScrollResult { scrolled: true }

export interface PageEvaluateParams {
  /** 函数源码字符串，如 "(x) => x * 2"；页面内执行，返回值需可 JSON 序列化 */
  fn: string;
  args?: unknown[];
  /** 缺省 ISOLATED（隔离世界，更安全）；MAIN 可访问页面 window 变量 */
  world?: "ISOLATED" | "MAIN";
  tabId?: number;
}
export interface PageEvaluateResult { value: unknown }
