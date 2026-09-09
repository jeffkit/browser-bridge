# 线协议

扩展 ↔ gateway 的 WebSocket 协议（当前版本 `proto: 1`）。与 web-bridge 的协议形状刻意一致。

## 消息形状

**扩展 → gateway：**

```jsonc
// 握手（连接后首条，10s 内）
{ "type": "hello", "proto": 1, "auth": "<token>", "client": { "name": "...", "version": "..." } }

// 心跳（每 20s，兼顾 Chrome service worker 保活）
{ "type": "ping" }

// 命令应答
{ "type": "result", "id": "r1", "ok": true,  "result": { ... } }
{ "type": "result", "id": "r1", "ok": false, "error": { "code": "stale_ref", "message": "..." } }
```

**gateway → 扩展：**

```jsonc
{ "type": "request", "id": "r1", "method": "page.click", "params": { "ref": "@e1" } }
{ "type": "pong" }
```

## 会话规则

- hello 鉴权失败 → close `4003`；协议版本不符 → close `4002`；
- 单浏览器会话：新连接顶替旧连接（旧连接收到 close `1000`）；
- gateway 为每个请求设超时（snapshot/evaluate 30s、navigate 20s、其余 10-15s），超时返回 `timeout`，扩展离线返回 `browser_disconnected`；
- gateway 不会主动向扩展发请求之外的任何推送。

## 方法集

`ping` / `tabs.list` / `tabs.get` / `tabs.create` / `tabs.close` / `tabs.activate` / `tabs.navigate` / `tabs.screenshot` / `page.snapshot` / `page.click` / `page.fill` / `page.type` / `page.press` / `page.scroll` / `page.evaluate`

完整参数/结果类型以 [`packages/protocol/src/methods.ts`](https://github.com/jeffkit/browser-bridge/blob/main/packages/protocol/src/methods.ts) 为权威定义；错误码见 [`packages/protocol/src/errors.ts`](https://github.com/jeffkit/browser-bridge/blob/main/packages/protocol/src/errors.ts)。

## 与 MCP 层的对应

MCP 工具几乎一一映射到线协议方法（`browser_click` → `page.click`），并在网关侧多做三件事：`--allow-url` 校验、默认超时注入、错误码转 Agent 可读文本（含排查提示）。见 `packages/gateway/src/mcp/tools.ts`。

## 演进

协议按 transport 分层设计：扩展侧只依赖「WS URL + token」，工具层只依赖 hub 抽象。未来新增公网 relay（双方都出站连中转）或多浏览器路由时，消息形状不变，`proto` 升号管理兼容。
