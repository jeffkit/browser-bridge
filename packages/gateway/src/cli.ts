#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BrowserHub } from "./hub.js";
import { createMcpServer } from "./mcp/server.js";
import { createStreamableHttpHandler } from "./mcp/http.js";
import {
  DEFAULT_PORT,
  GATEWAY_VERSION,
  generateToken,
  parseAllowUrls,
  type GatewayConfig,
} from "./config.js";

/** 所有日志走 stderr：stdio 模式下 stdout 是 MCP 通道，禁止污染。 */
function log(msg: string): void {
  console.error(`[browser-bridge] ${msg}`);
}

interface CommonOpts {
  port?: string;
  host?: string;
  token?: string;
  allowUrl?: string[];
}

function buildConfig(o: CommonOpts): GatewayConfig {
  return {
    port: o.port !== undefined ? Number(o.port) : DEFAULT_PORT,
    host: o.host ?? "0.0.0.0",
    // token 优先级：CLI > 环境变量 > 随机生成（调用方负责提示）
    token: o.token ?? process.env.BROWSER_BRIDGE_TOKEN ?? "",
    allowUrls: parseAllowUrls(o.allowUrl),
  };
}

async function runServe(o: CommonOpts): Promise<void> {
  const config = buildConfig(o);
  if (!config.token) {
    config.token = generateToken();
    log("未提供 --token / BROWSER_BRIDGE_TOKEN，已生成临时 token（重启会更换）：");
    log(`  token: ${config.token}`);
  }
  // handler 的 newServer 回调在首个 MCP 请求到达时才求值，此处闭包引用尚未初始化的 hub 是安全的
  const httpHandler = createStreamableHttpHandler(() => createMcpServer(hub));
  const hub = new BrowserHub({ config, log, httpHandler });
  await hub.start();
  const { port } = hub.address;
  log(`MCP(streamable HTTP) 端点：http://${config.host}:${port}/mcp`);
  log(`健康检查：http://${config.host}:${port}/healthz`);
  log(`扩展 options 里填：ws://<本机可达地址>:${port} + 上述 token`);
}

async function runMcp(o: CommonOpts): Promise<void> {
  const config = buildConfig(o);
  if (!config.token) {
    config.token = generateToken();
    log("未提供 --token / BROWSER_BRIDGE_TOKEN，已生成临时 token（重启会更换）：");
    log(`  token: ${config.token}`);
  }
  // 同进程：WS server 承载扩展，stdio 承载本地 agent 的 MCP 客户端
  const hub = new BrowserHub({ config, log });
  await hub.start();
  const { port } = hub.address;
  log(`stdio MCP 已就绪；扩展连接地址 ws://127.0.0.1:${port}`);
  const server = createMcpServer(hub);
  await server.connect(new StdioServerTransport());
}

async function runToken(): Promise<void> {
  console.log(generateToken());
}

export function runCli(argv: string[]): void {
  const program = new Command();
  program
    .name("browser-bridge-gateway")
    .description("browser-bridge gateway：扩展 WS 接入 + agent 侧 MCP（streamable HTTP / stdio）")
    .version(GATEWAY_VERSION);

  program
    .command("serve")
    .description("常驻模式：WS server（扩展接入）+ MCP streamable HTTP（远程 agent 接入）")
    .option("-p, --port <n>", "监听端口，0 为随机", DEFAULT_PORT.toString())
    .option("--host <h>", "监听地址", "0.0.0.0")
    .option("--token <t>", "扩展握手 token（或环境变量 BROWSER_BRIDGE_TOKEN）")
    .option("--allow-url <regex>", "URL 允许列表正则，可多次提供；缺省不限制", (v: string, prev: string[]) => [...prev, v], [] as string[])
    .action(async (opts: CommonOpts) => {
      await runServe(opts);
    });

  program
    .command("mcp")
    .description("同机模式：由 agent 以 stdio MCP 拉起本进程（内含扩展 WS server）")
    .option("-p, --port <n>", "扩展 WS 监听端口，0 为随机", DEFAULT_PORT.toString())
    .option("--host <h>", "监听地址", "0.0.0.0")
    .option("--token <t>", "扩展握手 token（或环境变量 BROWSER_BRIDGE_TOKEN）")
    .option("--allow-url <regex>", "URL 允许列表正则，可多次提供；缺省不限制", (v: string, prev: string[]) => [...prev, v], [] as string[])
    .action(async (opts: CommonOpts) => {
      await runMcp(opts);
    });

  program
    .command("token")
    .description("生成一个随机 pairing token")
    .action(async () => {
      await runToken();
    });

  program.parseAsync(argv).catch((err) => {
    log(`启动失败：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

// 直接执行（node dist/cli.js / npx bin）时启动；被测试 import 时不启动
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv);
}
