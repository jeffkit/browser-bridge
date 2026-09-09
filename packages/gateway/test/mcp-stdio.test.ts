import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");

interface JsonRpcMessage {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** 行分隔 JSON-RPC 客户端（MCP stdio）。收齐 expectReplies 条回复后主动 kill。 */
function talkToCli(
  args: string[],
  messages: Record<string, unknown>[],
  expectReplies: number,
): Promise<JsonRpcMessage[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const replies: JsonRpcMessage[] = [];
    let buf = "";
    const finish = (err?: Error) => {
      clearTimeout(timeout);
      child.removeAllListeners("exit");
      child.kill();
      if (err) reject(err);
      else resolve(replies);
    };
    const timeout = setTimeout(() => {
      finish(new Error(`stdio 超时，已收到 ${replies.length}/${expectReplies} 条回复`));
    }, 15_000);

    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcMessage;
          if (msg.id !== undefined) {
            replies.push(msg);
            if (replies.length >= expectReplies) finish();
          }
        } catch {
          finish(new Error(`无法解析 stdout 行：${line.slice(0, 200)}`));
        }
      }
    });
    child.stderr.on("data", () => {
      /* 日志走 stderr，测试忽略 */
    });
    child.on("error", (err) => finish(err));

    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
  });
}

describe("MCP stdio 入口（cli mcp）", () => {
  it("initialize + tools/list 走通", async () => {
    const replies = await talkToCli(
      ["mcp", "--port", "0", "--token", "stdio-test-token"],
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-agent", version: "0.0.1" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ],
      2,
    );

    const init = replies.find((r) => r.id === 1);
    expect(init?.result?.serverInfo).toMatchObject({ name: "browser-bridge-gateway" });

    const tools = (replies.find((r) => r.id === 2)?.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools.length).toBeGreaterThanOrEqual(12);
    expect(tools.map((t) => t.name)).toContain("browser_navigate");
  }, 25_000);
});
