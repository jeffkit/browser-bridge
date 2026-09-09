/**
 * 浏览器扩展 API 适配层：
 * - Chromium（Chrome/Edge）：chrome.*（MV3 promise 形式）
 * - Firefox：browser.*（promise 形式；chrome.* 在 Firefox 是回调风格，不能直接用）
 * 两者 API 形状一致，统一导出为 api。
 */
type BrowserApi = typeof chrome;

const impl =
  (globalThis as { browser?: BrowserApi }).browser ?? (globalThis as { chrome: BrowserApi }).chrome;

export const api: BrowserApi = impl;
