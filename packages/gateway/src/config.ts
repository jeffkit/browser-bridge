import { randomBytes } from "node:crypto";

export const DEFAULT_PORT = 17833;
export const GATEWAY_VERSION = "0.2.1";

export interface GatewayConfig {
  /** WS/MCP 监听端口，0 = 随机 */
  port: number;
  host: string;
  /** 扩展握手 token 注册表；relay 模式可多个。至少一项（CLI 层保证，缺省随机生成） */
  allowedTokens: string[];
  /** URL 允许列表（正则）；空 = 不限制。作用于 navigate/create 的目标 URL */
  allowUrls: RegExp[];
}

/** 生成 pairing token（URL 安全）。 */
export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

/** 解析 --allow-url 字符串为 RegExp；非法正则抛错（CLI 层转退出）。 */
export function parseAllowUrls(patterns: string[] | undefined): RegExp[] {
  return (patterns ?? []).map((p) => new RegExp(p));
}
