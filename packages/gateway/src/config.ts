import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

export const DEFAULT_PORT = 17833;
// 版本号唯一来源是 package.json（运行时经 createRequire 读取；bundle 后指向 npm 包自身，
// 避免再出现发版忘改常量导致 serverInfo 版本漂移）
const require = createRequire(import.meta.url);
export const GATEWAY_VERSION: string = require("../package.json").version;

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
