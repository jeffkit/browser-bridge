import type { BridgeError } from "./errors.js";

/** 当前线协议版本；双方 hello 不一致时 gateway 拒绝并提示升级。 */
export const PROTOCOL_VERSION = 1;

/** 协议层心跳间隔（毫秒）。扩展定时发 ping，gateway 回 pong。 */
export const HEARTBEAT_INTERVAL_MS = 20_000;
/** hello 握手超时（毫秒），超时未完成鉴权即断开。 */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** 缺省浏览器标识：单浏览器场景无需配置。 */
export const DEFAULT_BROWSER_ID = "default";

/** browserId 合法字符：URL 路径安全（/mcp/:browserId 路由用）。 */
export const BROWSER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 扩展 → gateway：握手。首条消息必须是 hello，auth 校验失败即断开。
 */
export interface HelloMessage {
  type: "hello";
  proto: number;
  auth: string;
  client: { name: string; version: string };
  /** 多浏览器标识：同一 gateway/relay 可同时挂多台浏览器，按此分流；缺省 default */
  browserId?: string;
}

/** 扩展 → gateway：心跳（SW 保活，Chrome ≥116 WS 活动会重置 idle timer）。 */
export interface PingMessage {
  type: "ping";
}

/** gateway → 扩展：心跳应答。 */
export interface PongMessage {
  type: "pong";
}

/** gateway → 扩展：命令请求。 */
export interface RequestMessage {
  type: "request";
  id: string;
  method: string;
  params: unknown;
}

/** 扩展 → gateway：命令应答。 */
export type ResultMessage =
  | { type: "result"; id: string; ok: true; result: unknown }
  | { type: "result"; id: string; ok: false; error: BridgeError };

/** 任何一端 → 另一端的消息 union。 */
export type WireMessage =
  | HelloMessage
  | PingMessage
  | PongMessage
  | RequestMessage
  | ResultMessage;

/** 解析并粗校验一条线消息；返回 null 表示无法识别（调用方应忽略并记日志）。 */
export function parseWireMessage(raw: string): WireMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const type = (value as { type?: unknown }).type;
  switch (type) {
    case "hello":
    case "ping":
    case "pong":
    case "request":
    case "result":
      return value as WireMessage;
    default:
      return null;
  }
}

/** 生成请求 id（gateway 侧使用；单调即可）。 */
export function makeRequestId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
