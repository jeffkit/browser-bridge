import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  bridgeError,
  BROWSER_ID_PATTERN,
  ErrorCode,
  DEFAULT_BROWSER_ID,
  HANDSHAKE_TIMEOUT_MS,
  HelloMessage,
  parseWireMessage,
  PROTOCOL_VERSION,
} from "@browser-bridge/protocol";
import { BrowserSession, newSessionId, type SessionClientInfo } from "./session.js";
import type { GatewayConfig } from "./config.js";

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface BrowserHubOptions {
  config: GatewayConfig;
  /** /mcp 等 HTTP 请求处理器（MCP streamable HTTP 入口挂载点）；未设则 404 */
  httpHandler?: HttpHandler;
  log?: (msg: string) => void;
}

export interface ConnectedBrowser {
  browserId: string;
  client: SessionClientInfo;
}

/**
 * 浏览器侧接入枢纽：
 * - WS server（根路径）承载扩展出站连接，hello+token 鉴权
 * - 多浏览器：按 hello.browserId 分流；同 browserId 新连接顶替旧连接，不同 browserId 并存
 * - 同一 HTTP server 挂 /healthz 与 MCP streamable HTTP（经 httpHandler）
 * - checkUrl 提供 --allow-url 允许列表校验
 */
export class BrowserHub {
  private httpServer: Server;
  private wss: WebSocketServer;
  /** browserId → 会话 */
  private sessions = new Map<string, BrowserSession>();
  private log: (msg: string) => void;

  constructor(private opts: BrowserHubOptions) {
    this.log = opts.log ?? ((m) => console.error(`[browser-bridge] ${m}`));
    this.httpServer = createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws, req) => {
      void this.handleConnection(ws, req);
    });
  }

  /** 取指定浏览器的会话（缺省 default）；未连接返回 null。 */
  getSession(browserId: string = DEFAULT_BROWSER_ID): BrowserSession | null {
    return this.sessions.get(browserId) ?? null;
  }

  /** 当前在线的浏览器列表（browser_status 展示用）。 */
  listBrowsers(): ConnectedBrowser[] {
    return [...this.sessions.entries()].map(([browserId, s]) => ({
      browserId,
      client: s.client,
    }));
  }

  get address(): { port: number; host: string } {
    const addr = this.httpServer.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    return { port, host: this.opts.config.host };
  }

  async start(): Promise<void> {
    const { port, host } = this.opts.config;
    await new Promise<void>((resolve, reject) => {
      this.httpServer.once("error", reject);
      this.httpServer.listen(port, host, () => {
        this.httpServer.off("error", reject);
        resolve();
      });
    });
    this.log(`gateway 监听 ws://${host}:${this.address.port}（/healthz、/mcp[/:browserId]）`);
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) session.close("gateway stopping");
    this.sessions.clear();
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
  }

  /** --allow-url 校验：未配置则全放行。 */
  checkUrl(url: string): boolean {
    const allow = this.opts.config.allowUrls;
    if (allow.length === 0) return true;
    try {
      return allow.some((re) => re.test(url));
    } catch {
      return false;
    }
  }

  /** 已配置的允许列表条数（0 = 不限制）。 */
  get allowUrlCount(): number {
    return this.opts.config.allowUrls.length;
  }

  requireUrlAllowed(url: string): void {
    if (!this.checkUrl(url)) {
      throw bridgeError(
        ErrorCode.UrlNotAllowed,
        `URL 不在允许列表内（--allow-url）：${url}`,
        { url },
      );
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, browsers: this.listBrowsers().length }));
      return;
    }
    if (this.opts.httpHandler) {
      try {
        await this.opts.httpHandler(req, res);
      } catch (err) {
        this.log(`HTTP handler 异常：${err instanceof Error ? err.stack : String(err)}`);
        if (!res.headersSent) res.writeHead(500).end();
        else res.end();
      }
      return;
    }
    res.writeHead(404).end();
  }

  private async handleConnection(ws: WebSocket, _req: IncomingMessage): Promise<void> {
    let hello: HelloMessage;
    try {
      hello = await this.awaitHello(ws);
    } catch (err) {
      this.log(`握手失败：${err instanceof Error ? err.message : String(err)}`);
      ws.close(4001, "handshake failed");
      return;
    }
    if (hello.proto !== PROTOCOL_VERSION) {
      this.log(`协议版本不匹配：扩展 proto=${hello.proto}，gateway proto=${PROTOCOL_VERSION}`);
      ws.close(4002, "protocol version mismatch");
      return;
    }
    if (!this.opts.config.allowedTokens.includes(hello.auth)) {
      this.log(`token 校验失败，拒绝连接`);
      ws.close(4003, "auth failed");
      return;
    }
    const browserId = hello.browserId ?? DEFAULT_BROWSER_ID;
    if (!BROWSER_ID_PATTERN.test(browserId)) {
      this.log(`browserId 非法（需匹配 ${BROWSER_ID_PATTERN}）：${browserId}`);
      ws.close(4004, "invalid browserId");
      return;
    }

    const client: SessionClientInfo = { name: hello.client.name, version: hello.client.version };
    const session = new BrowserSession(newSessionId(), ws, client, hello.auth, this.log);

    // 同一 browserId：新连接顶替旧连接；不同 browserId 并存
    const existing = this.sessions.get(browserId);
    if (existing) {
      this.log(
        `浏览器「${browserId}」新连接 ${session.id}（${client.name} v${client.version}）顶替 ${existing.id}`,
      );
      existing.close("replaced by new connection");
    } else {
      this.log(`浏览器「${browserId}」已连接 ${session.id}（${client.name} v${client.version}）`);
    }
    this.sessions.set(browserId, session);

    ws.on("message", (data) => {
      const msg = parseWireMessage(String(data));
      if (!msg) {
        this.log(`无法识别的消息：${String(data).slice(0, 200)}`);
        return;
      }
      if (this.sessions.get(browserId) === session) session.handleMessage(msg);
    });
    ws.on("close", () => {
      if (this.sessions.get(browserId) === session) {
        this.log(`浏览器「${browserId}」连接断开`);
        this.sessions.delete(browserId);
      }
      session.close("socket closed");
    });
    ws.on("error", (err) => this.log(`扩展连接错误：${err.message}`));
  }

  /** 等待首条 hello（带握手超时）；其余消息直接拒绝。 */
  private awaitHello(ws: WebSocket): Promise<HelloMessage> {
    return new Promise<HelloMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`握手超时（${HANDSHAKE_TIMEOUT_MS}ms 内未收到 hello）`));
      }, HANDSHAKE_TIMEOUT_MS);
      const onMessage = (data: unknown) => {
        const msg = parseWireMessage(String(data));
        if (!msg || msg.type !== "hello") {
          cleanup();
          reject(new Error("首条消息必须是 hello"));
          return;
        }
        cleanup();
        resolve(msg);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("连接在握手中断开"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        ws.off("message", onMessage);
        ws.off("close", onClose);
      };
      ws.on("message", onMessage);
      ws.on("close", onClose);
    });
  }
}
