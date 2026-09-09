import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { BrowserHub } from "../hub.js";
import { GATEWAY_VERSION } from "../config.js";
import { TOOLS, errorResult } from "./tools.js";

export const MCP_SERVER_NAME = "browser-bridge-gateway";

/**
 * 装配一个注册好全部 browser_* 工具的 McpServer。
 * 每个 MCP 会话（stdio 进程 / streamable HTTP 会话）各一个实例，共享同一 hub。
 */
export function createMcpServer(hub: BrowserHub): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: GATEWAY_VERSION });
  for (const def of TOOLS) {
    server.tool(def.name, def.description, def.schema, async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const out = await def.handler(args, hub);
        // handler 已构造 MCP content（如 screenshot 的 image）则直接透传
        if (isCallToolResult(out)) return out;
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    });
  }
  return server;
}

function isCallToolResult(value: unknown): value is CallToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}
