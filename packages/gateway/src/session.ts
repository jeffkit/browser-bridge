import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  bridgeError,
  ErrorCode,
  makeRequestId,
  type NavBlockedMessage,
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

/** 导航兜底拦截记录（扩展上报，browser_status 展示给 agent）。 */
export interface NavBlockRecord {
  tabId: number;
  url: string;
  from?: string;
  code: string;
  at: number;
}

/** navBlocks 保留条数上限。 */
const NAV_BLOCK_LIMIT = 20;

/**
 * 一条已通过鉴权的扩展连接。负责「请求 → 等 result」的关联与超时，
 * 以及本会话的 owner 集合（本会话创建/导航过的 tab）与导航拦截记录。
 */
export class BrowserSession {
  private pending = new Map<string, PendingEntry>();
  /** 本会话（连接生命周期）创建或导航过的 tabId；browserId 重连即清空 */
  private ownedTabs = new Set<number>();
  /** 扩展上报的导航兜底拦截（最新在后） */
  readonly navBlocks: NavBlockRecord[] = [];

  constructor(
    readonly id: string,
    private ws: WebSocket,
    readonly client: SessionClientInfo,
    /** 该会话握手用的 token（relay 模式下 MCP Bearer 需与其绑定） */
    readonly token: string,
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
    if (msg.type === "nav_blocked") {
      this.recordNavBlock(msg);
      return;
    }
    // gateway → 扩展单向通道，扩展不应发 request/pong/allowlist
    this.log(`忽略扩展消息 type=${(msg as { type: string }).type}`);
  }

  /** 记为 owned（本会话创建/导航过的 tab）。 */
  ownTab(tabId: number): void {
    this.ownedTabs.add(tabId);
  }

  ownsTab(tabId: number): boolean {
    return this.ownedTabs.has(tabId);
  }

  get ownedTabIds(): number[] {
    return [...this.ownedTabs];
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

  private recordNavBlock(msg: NavBlockedMessage): void {
    this.navBlocks.push({
      tabId: msg.tabId,
      url: msg.url,
      ...(msg.from !== undefined ? { from: msg.from } : {}),
      code: msg.code,
      at: Date.now(),
    });
    if (this.navBlocks.length > NAV_BLOCK_LIMIT) {
      this.navBlocks.splice(0, this.navBlocks.length - NAV_BLOCK_LIMIT);
    }
    this.log(`导航兜底拦截 [${msg.code}] tab=${msg.tabId} → ${msg.url}（已回退 ${msg.from ?? "about:blank"}）`);
  }

  /** 向扩展发送消息（hub 下发 allowlist 也走这里）。 */
  send(msg: WireMessage): void {
    if (!this.connected) return;
    this.ws.send(JSON.stringify(msg));
  }
}

export function newSessionId(): string {
  return randomUUID();
}
