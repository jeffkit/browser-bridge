import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { BROWSER_ID_PATTERN } from "@browser-bridge/protocol";

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
  /** browserId → token 绑定（严格模式：非空时 hello/MCP Bearer 必须等于该 browserId 的绑定值，未映射 browserId 一律拒绝）；serve/mcp 留空 = 仅注册表校验 */
  browserTokens?: Map<string, string>;
}

/** 生成 pairing token（URL 安全）。 */
export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

/** 解析 --allow-url 字符串为 RegExp；非法正则抛错（CLI 层转退出）。 */
export function parseAllowUrls(patterns: string[] | undefined): RegExp[] {
  return (patterns ?? []).map((p) => new RegExp(p));
}

/** 解析 relay 的 --token <browserId>=<token> 为映射；格式/唯一性非法或为空即抛错（CLI 层转退出）。 */
export function parseBrowserTokens(entries: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const i = entry.indexOf("=");
    const browserId = i > 0 ? entry.slice(0, i) : "";
    const token = i > 0 ? entry.slice(i + 1) : "";
    if (i <= 0 || entry.indexOf("=", i + 1) !== -1) {
      throw new Error(`--token 需为 <browserId>=<token> 形式：${entry}`);
    }
    if (!BROWSER_ID_PATTERN.test(browserId)) {
      throw new Error(`browserId 非法（需匹配 ${BROWSER_ID_PATTERN}）：${browserId}`);
    }
    if (!token) throw new Error(`token 不能为空：${entry}`);
    if (map.has(browserId)) throw new Error(`browserId 重复映射：${browserId}`);
    if (seen.has(token)) throw new Error(`token 不能映射到多个 browserId：${token}`);
    map.set(browserId, token);
    seen.add(token);
  }
  if (map.size === 0) throw new Error("relay 需至少一个 --token <browserId>=<token>");
  return map;
}
