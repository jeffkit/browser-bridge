import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  bridgeError,
  ErrorCode,
  makeRequestId,
  type ResultMessage,
  type WireMessage,
} from "@browser-bridge/protocol";

export interface SessionClientInfo {
  name: string;
  version: string;
}

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (err: { code: string; message: string; data?: unknown }) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

/**
 * 一条已通过鉴权的扩展连接。负责「请求 → 等 result」的关联与超时。
 */
export class BrowserSession {
  private pending = new Map<string, PendingEntry>();

  constructor(
    readonly id: string,
    private ws: WebSocket,
    readonly client: SessionClientInfo,
    private log: (msg: string) => void,
  ) {}

  get connected(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }

  /** 向扩展发请求；返回 result.result 或抛 BridgeError 形状的错误。 */
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.connected) {
      return Promise.reject(bridgeError(ErrorCode.BrowserDisconnected, "浏览器扩展未连接"));
    }
    const id = makeRequestId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          bridgeError(ErrorCode.Timeout, `方法 ${method} 等待扩展响应超时（${timeoutMs}ms）`, {
            method,
            timeoutMs,
          }),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.send({ type: "request", id, method, params });
    });
  }

  /** 处理扩展发来的消息（hub 已完成解析与 hello 分流）。 */
  handleMessage(msg: WireMessage): void {
    if (msg.type === "result") {
      this.settle(msg as ResultMessage);
      return;
    }
    if (msg.type === "ping") {
      this.send({ type: "pong" });
      return;
    }
    // gateway → 扩展单向通道，扩展不应发 request/pong
    this.log(`忽略扩展消息 type=${(msg as { type: string }).type}`);
  }

  close(reason = "replaced"): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(
        bridgeError(ErrorCode.BrowserDisconnected, `浏览器扩展已断开（${reason}）`, {
          method: entry.method,
        }),
      );
      this.pending.delete(id);
    }
    try {
      this.ws.close(1000, reason);
    } catch {
      this.ws.terminate();
    }
  }

  private settle(msg: ResultMessage): void {
    const entry = this.pending.get(msg.id);
    if (!entry) {
      this.log(`收到未知请求 id=${msg.id} 的 result，忽略`);
      return;
    }
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(msg.error);
  }

  private send(msg: WireMessage): void {
    this.ws.send(JSON.stringify(msg));
  }
}

export function newSessionId(): string {
  return randomUUID();
}
