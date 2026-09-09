import WebSocket from "ws";

export const TOKEN = "test-token-1234";

export function openWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

export function sendHello(ws: WebSocket, auth: string = TOKEN): void {
  ws.send(
    JSON.stringify({
      type: "hello",
      proto: 1,
      auth,
      client: { name: "fake-extension", version: "0.0.1" },
    }),
  );
}

/** 等一条 JSON 消息（可按 type 过滤）。 */
export function recvJson(ws: WebSocket, type?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: unknown) => {
      const msg = JSON.parse(String(data)) as Record<string, unknown>;
      if (type === undefined || msg.type === type) {
        cleanup();
        resolve(msg);
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("connection closed while waiting for message"));
    };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("close", onClose);
    };
    ws.on("message", onMessage);
    ws.on("close", onClose);
  });
}

/** 等到条件成立（轮询）。 */
export async function waitUntil(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}
