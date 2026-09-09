import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  BROWSER_ID_PATTERN,
  DEFAULT_BROWSER_ID,
} from "@browser-bridge/protocol";
import type { HttpHandler } from "../hub.js";

export const MCP_HTTP_PATH = "/mcp";

interface McpHttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export interface StreamableHttpOptions {
  /**
   * MCP 侧鉴权（relay 公网部署必开）：返回 false 即 401。
   * serve（可信内网）不设；relay 校验 Bearer token。
   */
  authenticate?: (req: IncomingMessage, browserId: string) => boolean;
}

/** 从 Authorization 头提取 Bearer token；无则 null。 */
export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? (m[1] ?? null) : null;
}

/**
 * MCP streamable HTTP 入口（stateful：每会话一个 server+transport）。
 * - 路径 /mcp → default 浏览器；/mcp/:browserId → 绑定对应浏览器（工具面相同）
 * - POST 无会话头 → 必须是 initialize；POST/GET/DELETE 带会话头 → 路由到既有会话
 */
export function createStreamableHttpHandler(
  newServer: (browserId: string) => McpServer,
  opts: StreamableHttpOptions = {},
): HttpHandler {
  const sessions = new Map<string, McpHttpSession>();

  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    let browserId: string;
    if (path === MCP_HTTP_PATH) {
      browserId = DEFAULT_BROWSER_ID;
    } else if (path.startsWith(`${MCP_HTTP_PATH}/`)) {
      browserId = decodeURIComponent(path.slice(MCP_HTTP_PATH.length + 1));
    } else {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (!BROWSER_ID_PATTERN.test(browserId)) {
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: `invalid browserId: ${browserId}` }));
      return;
    }
    if (opts.authenticate && !opts.authenticate(req, browserId)) {
      res
        .writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" })
        .end(JSON.stringify({ error: "unauthorized: missing or invalid bearer token" }));
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (sessionId && !existing) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "session not found" }));
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (existing) {
        await existing.transport.handleRequest(req, res, body);
        return;
      }
      if (body !== null && isInitializeRequest(body)) {
        let session: McpHttpSession | undefined;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id: string) => {
            if (session) sessions.set(id, session);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        session = { server: newServer(browserId), transport };
        await session.server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "new connections must send an initialize request" }));
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!existing) {
        res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "session not found" }));
        return;
      }
      await existing.transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405, { allow: "GET, POST, DELETE" }).end();
  };
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
