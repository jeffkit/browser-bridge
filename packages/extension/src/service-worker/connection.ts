import {
  HelloMessage,
  HEARTBEAT_INTERVAL_MS,
  parseWireMessage,
  PROTOCOL_VERSION,
  type ResultMessage,
  type WireMessage,
} from "@browser-bridge/protocol";
import { loadConfig, onConfigChanged, type ExtConfig } from "../common/config.js";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

interface RequestEnvelope {
  type: "request";
  id: string;
  method: string;
  params: unknown;
}

/**
 * 出站 WebSocket 连接管理：
 * - 配置就绪才连接；配置变更即重连
 * - hello 握手；20s 应用层心跳（WS 活动让 Chrome ≥116 不休眠 SW）
 * - 断线指数退避重连（1s → 30s）
 */
export class Connection {
  status: ConnectionState = "disconnected";
  lastError = "";
  /** 收到 gateway 命令时的处理器（router.dispatch） */
  onRequest: ((req: RequestEnvelope) => Promise<unknown>) | null = null;

  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 1_000;
  private cfg: ExtConfig = { gatewayUrl: "", token: "" };
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.cfg = await loadConfig();
    onConfigChanged((cfg) => {
      this.cfg = cfg;
      this.log("配置已更新，重连中…");
      this.teardown();
      this.scheduleReconnect(0);
    });
    this.connect();
  }

  private log(msg: string): void {
    console.log(`[browser-bridge] ${msg}`);
  }

  private connect(): void {
    const { gatewayUrl, token } = this.cfg;
    if (!gatewayUrl || !token) {
      this.status = "disconnected";
      this.lastError = "尚未配置 gateway 地址或 token，请打开扩展设置";
      return;
    }
    this.status = "connecting";
    this.lastError = "";
    let ws: WebSocket;
    try {
      ws = new WebSocket(gatewayUrl);
    } catch (err) {
      this.status = "error";
      this.lastError = `gateway 地址无效：${String(err)}`;
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      const hello: HelloMessage = {
        type: "hello",
        proto: PROTOCOL_VERSION,
        auth: token,
        client: { name: "browser-bridge-extension", version: chrome.runtime.getManifest().version },
      };
      ws.send(JSON.stringify(hello));
      this.status = "connected";
      this.backoffMs = 1_000;
      this.log(`已连接 ${gatewayUrl}`);
      this.startHeartbeat(ws);
    };

    ws.onmessage = (event) => {
      const msg = parseWireMessage(String(event.data));
      if (!msg) return;
      if (msg.type === "pong") return;
      if (msg.type === "request") {
        void this.handleRequest(ws, msg as RequestEnvelope);
      }
    };

    ws.onclose = (event) => {
      if (this.ws === ws) {
        this.status = "disconnected";
        this.lastError = `连接关闭（code=${event.code}）`;
        this.stopHeartbeat();
        this.ws = null;
        // 4003=token 错、4002=协议版本不符：重试也不会成功，放慢让人先修配置
        this.scheduleReconnect(event.code === 4002 || event.code === 4003 ? 30_000 : undefined);
      }
    };

    ws.onerror = () => {
      if (this.ws === ws) {
        this.status = "error";
        this.lastError = "连接失败（地址不可达或 TLS 问题）";
      }
    };
  }

  private async handleRequest(ws: WebSocket, req: RequestEnvelope): Promise<void> {
    let result: ResultMessage;
    if (!this.onRequest) {
      result = { type: "result", id: req.id, ok: false, error: { code: "internal", message: "router 未就绪" } };
    } else {
      try {
        const value = await this.onRequest(req);
        result = { type: "result", id: req.id, ok: true, result: value };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        result = {
          type: "result",
          id: req.id,
          ok: false,
          error: { code: e?.code ?? "internal", message: e?.message ?? String(err) },
        };
      }
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(result));
    }
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" } satisfies WireMessage));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private teardown(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close(1000, "reconfigure");
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectTimer) return;
    const delay = delayMs ?? this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
