import { GATEWAY_VERSION } from "../config.js";

export interface CallToolOptions {
  /** MCP streamable HTTP 端点（可含 /<browserId> 路径） */
  url: string;
  /** relay 模式的 Bearer token */
  bearer?: string;
  tool: string;
  args: Record<string, unknown>;
  timeoutSec: number;
}

export interface ToolImage {
  mimeType: string;
  base64: string;
}

export interface CallToolResult {
  isError: boolean;
  textParts: string[];
  images: ToolImage[];
}

function extractDataLine(text: string): unknown {
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  if (dataLine) return JSON.parse(dataLine.slice(5).trim());
  return text ? JSON.parse(text) : null;
}

/**
 * streamable HTTP 瘦客户端：按需调用单个工具（initialize → initialized → tools/call），
 * 用完即弃。供 `gateway call` 子命令与 Skill 用法使用，免常驻 MCP 配置。
 */
export async function callToolViaHttp(opts: CallToolOptions): Promise<CallToolResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
  };
  const post = async (body: Record<string, unknown>, sessionId?: string): Promise<{ status: number; sessionId?: string; body: any }> => {
    const res = await fetch(opts.url, {
      method: "POST",
      headers: { ...headers, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutSec * 1000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`);
    }
    return { status: res.status, sessionId: res.headers.get("mcp-session-id") ?? undefined, body: extractDataLine(text) };
  };

  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "browser-bridge-cli", version: GATEWAY_VERSION },
    },
  });
  const sessionId = init.sessionId;
  if (!sessionId) throw new Error("gateway 未返回 mcp-session-id，端点可能不是 browser-bridge 的 /mcp");

  try {
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);

    const call = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: opts.tool, arguments: opts.args } },
      sessionId,
    );
    const result = call.body?.result;
    if (!result) throw new Error(`异常响应：${JSON.stringify(call.body).slice(0, 300)}`);

    const textParts: string[] = [];
    const images: ToolImage[] = [];
    for (const part of result.content ?? []) {
      if (part?.type === "text") textParts.push(String(part.text));
      else if (part?.type === "image") images.push({ mimeType: part.mimeType ?? "image/png", base64: part.data ?? "" });
    }
    return { isError: result.isError === true, textParts, images };
  } finally {
    // 礼貌关闭会话；失败无所谓（gateway 会话有超时回收）
    fetch(opts.url, {
      method: "DELETE",
      headers: { ...headers, "mcp-session-id": sessionId },
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
}
