#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { IncomingMessage } from "node:http";
import { Command } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_BROWSER_ID } from "@browser-bridge/protocol";
import { BrowserHub } from "./hub.js";
import { createMcpServer } from "./mcp/server.js";
import { bearerToken, createStreamableHttpHandler } from "./mcp/http.js";
import { GATEWAY_VERSION, generateToken, parseAllowUrls, type GatewayConfig } from "./config.js";

/** 所有日志走 stderr：stdio 模式下 stdout 是 MCP 通道，禁止污染。 */
function log(msg: string): void {
  console.error(`[browser-bridge] ${msg}`);
}

interface CommonOpts {
  port?: string;
  host?: string;
  token?: string[];
  allowUrl?: string[];
}

function buildConfig(o: CommonOpts): GatewayConfig {
  const tokens = [...(o.token ?? [])];
  if (process.env.BROWSER_BRIDGE_TOKEN) tokens.push(process.env.BROWSER_BRIDGE_TOKEN);
  return {
    port: o.port !== undefined ? Number(o.port) : 17833,
    host: o.host ?? "0.0.0.0",
    allowedTokens: tokens,
    allowUrls: parseAllowUrls(o.allowUrl),
  };
}

/** token 缺省时随机生成（打印在 stderr，提示重启会换）。 */
function ensureTokens(config: GatewayConfig): void {
  if (config.allowedTokens.length === 0) {
    config.allowedTokens = [generateToken()];
    log("未提供 --token / BROWSER_BRIDGE_TOKEN，已生成临时 token（重启会更换）：");
    log(`  token: ${config.allowedTokens[0]}`);
  }
}

async function runServe(o: CommonOpts): Promise<void> {
  const config = buildConfig(o);
  ensureTokens(config);
  // handler 的 newServer 回调在首个 MCP 请求到达时才求值，此处闭包引用尚未初始化的 hub 是安全的
  const httpHandler = createStreamableHttpHandler((browserId) => createMcpServer(hub, browserId));
  const hub = new BrowserHub({ config, log, httpHandler });
  await hub.start();
  const { port } = hub.address;
  log(`MCP(streamable HTTP) 端点：http://${config.host}:${port}/mcp（可加 /<browserId> 绑定指定浏览器）`);
  log(`健康检查：http://${config.host}:${port}/healthz`);
  log(`扩展 options 里填：ws://<本机可达地址>:${port} + token + 浏览器 ID`);
}

async function runMcp(o: CommonOpts): Promise<void> {
  const config = buildConfig(o);
  ensureTokens(config);
  // 同进程：WS server 承载扩展，stdio 承载本地 agent 的 MCP 客户端（绑定 default 浏览器）
  const hub = new BrowserHub({ config, log });
  await hub.start();
  const { port } = hub.address;
  log(`stdio MCP 已就绪（绑定浏览器「${DEFAULT_BROWSER_ID}」）；扩展连接地址 ws://127.0.0.1:${port}`);
  const server = createMcpServer(hub, DEFAULT_BROWSER_ID);
  await server.connect(new StdioServerTransport());
}

/**
 * relay 公网中转：扩展与 agent 都出站连接本服务（双方都无需公网地址）。
 * 与 serve 的差别：多 token 注册表 + MCP 强制 Bearer 鉴权，面向公网部署。
 */
async function runRelay(o: CommonOpts): Promise<void> {
  const config = buildConfig(o);
  ensureTokens(config);
  const registry = new Set(config.allowedTokens);
  log(`token 注册表：${registry.size} 个（扩展与 agent 的 Bearer 均须来自其中）`);

  // 已连接的浏览器槽位：Bearer 必须等于该浏览器的配对 token，防止跨用户操控；
  // 浏览器离线时：Bearer 是注册表内任一合法 token 即可（后续连接仍受 hello token 约束）
  const authenticate = (req: IncomingMessage, browserId: string): boolean => {
    const bearer = bearerToken(req);
    if (!bearer || !registry.has(bearer)) return false;
    const session = hub.getSession(browserId);
    return session ? bearer === session.token : true;
  };

  const httpHandler = createStreamableHttpHandler((browserId) => createMcpServer(hub, browserId), {
    authenticate,
  });
  const hub = new BrowserHub({ config, log, httpHandler });
  await hub.start();
  const { port } = hub.address;
  log(`relay MCP 端点：http://${config.host}:${port}/mcp/<浏览器ID>，请求头 Authorization: Bearer <token>`);
  log(`健康检查：http://${config.host}:${port}/healthz`);
  log("扩展 options 里填本 relay 地址 + 注册表内 token + 各自的浏览器 ID；公网部署请前置 TLS（wss）");
}

async function runToken(): Promise<void> {
  console.log(generateToken());
}

interface CallOpts {
  url: string;
  bearer?: string;
  args: string;
  timeout: string;
  saveImage?: string;
  raw: boolean;
}

/** `call` 子命令：免常驻 MCP 配置，按需调用单个工具并输出结果。 */
async function runCall(tool: string, o: CallOpts): Promise<void> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(o.args) as Record<string, unknown>;
  } catch (err) {
    console.error(`--args 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  try {
    const { callToolViaHttp } = await import("./mcp/client.js");
    const { writeFileSync } = await import("node:fs");
    const result = await callToolViaHttp({
      url: o.url,
      bearer: o.bearer,
      tool,
      args,
      timeoutSec: Number(o.timeout) || 60,
    });
    if (o.raw) {
      console.log(
        JSON.stringify({ isError: result.isError, text: result.textParts, images: result.images }, null, 2),
      );
    } else {
      for (const text of result.textParts) console.log(text);
      for (const image of result.images) {
        if (o.saveImage) {
          writeFileSync(o.saveImage, Buffer.from(image.base64, "base64"));
          console.log(`图片已保存：${o.saveImage}（${image.mimeType}）`);
        } else {
          console.log(`data:${image.mimeType};base64,${image.base64}`);
        }
      }
    }
    if (result.isError) process.exitCode = 1;
  } catch (err) {
    console.error(`调用失败：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

export function runCli(argv: string[]): void {
  const program = new Command();
  program
    .name("browser-bridge-gateway")
    .description("browser-bridge gateway：扩展 WS 接入 + agent 侧 MCP（streamable HTTP / stdio / relay 中转）")
    .version(GATEWAY_VERSION);

  const commonOptions = (cmd: Command): Command => {
    cmd
      .option("-p, --port <n>", "监听端口，0 为随机", "17833")
      .option("--host <h>", "监听地址", "0.0.0.0")
      .option("--token <t>", "扩展握手 token（可多次；也可用环境变量 BROWSER_BRIDGE_TOKEN）", (v: string, prev: string[]) => [...prev, v], [] as string[])
      .option("--allow-url <regex>", "URL 允许列表正则，可多次提供；缺省不限制", (v: string, prev: string[]) => [...prev, v], [] as string[]);
    return cmd;
  };

  commonOptions(
    program
      .command("serve")
      .description("常驻模式：WS server（扩展接入）+ MCP streamable HTTP（远程 agent 接入）"),
  ).action(async (opts: CommonOpts) => {
    await runServe(opts);
  });

  commonOptions(
    program
      .command("mcp")
      .description("同机模式：由 agent 以 stdio MCP 拉起本进程（内含扩展 WS server）"),
  ).action(async (opts: CommonOpts) => {
    await runMcp(opts);
  });

  commonOptions(
    program
      .command("relay")
      .description("公网中转模式：扩展与 agent 都出站连接本服务；多 token + MCP 强制 Bearer 鉴权"),
  ).action(async (opts: CommonOpts) => {
    await runRelay(opts);
  });

  program
    .command("token")
    .description("生成一个随机 pairing token")
    .action(async () => {
      await runToken();
    });

  program
    .command("call")
    .description("按需调用 browser_* 工具（对 /mcp 的瘦客户端，免常驻 MCP 配置），如：call browser_snapshot")
    .argument("<tool>", "工具名，如 browser_status / browser_snapshot / browser_click")
    .option("--url <u>", "MCP streamable HTTP 端点（可含 /<browserId> 路径）", "http://127.0.0.1:17833/mcp")
    .option("--bearer <t>", "Bearer token（relay 模式）；或环境变量 BROWSER_BRIDGE_BEARER", process.env.BROWSER_BRIDGE_BEARER)
    .option("--args <json>", "工具参数 JSON", "{}")
    .option("--timeout <sec>", "超时秒数", "60")
    .option("--save-image <path>", "结果含图片（截图）时保存到该文件，避免输出超长 base64")
    .option("--raw", "输出完整 JSON-RPC result 而非仅 content 文本")
    .action(async (tool: string, opts: CallOpts) => {
      await runCall(tool, opts);
    });

  program.parseAsync(argv).catch((err) => {
    log(`启动失败：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

// 直接执行（node dist/cli.js / npm bin / npx）时启动；被测试 import 时不启动。
// argv[1] 经 .bin symlink 调用时是链接路径，必须 realpath 后再与 import.meta.url 比较
if (process.argv[1]) {
  try {
    const entry = pathToFileURL(realpathSync(process.argv[1])).href;
    if (import.meta.url === entry) {
      runCli(process.argv);
    }
  } catch {
    /* argv[1] 不存在等异常：非直接执行场景 */
  }
}
