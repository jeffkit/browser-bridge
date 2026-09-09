/**
 * 错误码：扩展 → gateway 的 result.error.code 与 gateway → agent 的 MCP 错误共用。
 */
export const ErrorCode = {
  /** hello 鉴权失败（token 不匹配） */
  AuthFailed: "auth_failed",
  /** gateway 收到请求时浏览器扩展未连接 */
  BrowserDisconnected: "browser_disconnected",
  /** 请求等待扩展响应超时 */
  Timeout: "timeout",
  /** 未知方法 */
  MethodNotFound: "method_not_found",
  /** 参数缺失或非法 */
  BadParams: "bad_params",
  /** 目标 tab 不存在或已关闭 */
  TabNotFound: "tab_not_found",
  /** 截图失败（通常是无可见 tab 或权限问题） */
  ScreenshotFailed: "screenshot_failed",
  /** 导航在超时窗口内未达到目标状态 */
  NavigationTimeout: "navigation_timeout",
  /** content script 未注入 / 页面不可注入（chrome:// 等受限页） */
  PageNotInjectable: "page_not_injectable",
  /** 页面内操作失败（元素消失、选择器失效等） */
  PageActionFailed: "page_action_failed",
  /** snapshot 的 @eN 引用已失效（页面跳转/刷新后缓存清空） */
  StaleRef: "stale_ref",
  /** 页面脚本执行抛错或返回不可序列化值 */
  EvaluateFailed: "evaluate_failed",
  /** URL 命中 --allow-url 拒绝列表之外 / 未在允许列表内 */
  UrlNotAllowed: "url_not_allowed",
  /** 兜底 */
  Internal: "internal",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 统一错误形状：随 result 消息的 error 字段与 MCP 工具错误文本流转。 */
export interface BridgeError {
  code: ErrorCodeValue | string;
  message: string;
  /** 附加上下文，如超时的方法名、出错 tab 的 URL */
  data?: unknown;
}

export function bridgeError(code: ErrorCodeValue | string, message: string, data?: unknown): BridgeError {
  return { code, message, ...(data !== undefined ? { data } : {}) };
}

/** 已知错误码的人类可读提示（生成给 agent 的错误文本用） */
export const ErrorCodeHints: Record<string, string> = {
  [ErrorCode.AuthFailed]: "扩展握手 token 不匹配，请检查扩展 options 里配置的 token 与 gateway 启动参数是否一致。",
  [ErrorCode.BrowserDisconnected]: "浏览器扩展未连接到 gateway，请在本地浏览器打开扩展并确认 options 里的 gateway 地址。",
  [ErrorCode.Timeout]: "扩展响应超时，页面可能卡死或浏览器忙碌，可重试或加大 timeoutMs。",
  [ErrorCode.TabNotFound]: "目标 tab 已关闭，先 browser_tab_list 获取当前有效 tab。",
  [ErrorCode.PageNotInjectable]: "该页面不允许注入脚本（如 chrome:// 网上应用店、PDF 查看器），请换普通网页。",
  [ErrorCode.StaleRef]: "元素引用已失效（页面跳转或刷新），请重新 browser_snapshot。",
};
