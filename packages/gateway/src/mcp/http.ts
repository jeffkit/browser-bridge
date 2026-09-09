import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { HttpHandler } from "../hub.js";

export const MCP_HTTP_PATH = "/mcp";

interface McpHttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

/**
 * MCP streamable HTTP 入口（stateful：每会话一个 server+transport）。
 * POST 无会话头 → 必须是 initialize；POST/GET/DELETE 带会话头 → 路由到既有会话。
 */
export function createStreamableHttpHandler(newServer: () => McpServer): HttpHandler {
  const sessions = new Map<string, McpHttpSession>();

  const closeSession = (sessionId: string) => {
    sessions.delete(sessionId);
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== MCP_HTTP_PATH) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
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
          if (transport.sessionId) closeSession(transport.sessionId);
        };
        session = { server: newServer(), transport };
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
