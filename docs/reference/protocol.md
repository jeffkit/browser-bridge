# 线协议

扩展 ↔ gateway 的 WebSocket 协议（当前版本 `proto: 2`）。与 web-bridge 的协议形状刻意一致。

## 消息形状

**扩展 → gateway：**

```jsonc
// 握手（连接后首条，10s 内）；browserId 缺省为 "default"
{ "type": "hello", "proto": 2, "auth": "<token>", "client": { "name": "...", "version": "..." }, "browserId": "laptop" }

// 心跳（每 20s，兼顾 Chrome service worker 保活）
{ "type": "ping" }

// 命令应答
{ "type": "result", "id": "r1", "ok": true,  "result": { ... } }
{ "type": "result", "id": "r1", "ok": false, "error": { "code": "stale_ref", "message": "..." } }

// 导航兜底拦截上报（点链接/表单提交/JS 跳转越界，扩展已回退到 from）
{ "type": "nav_blocked", "tabId": 5, "url": "https://evil.example/", "from": "https://example.com/", "code": "url_not_allowed" }
```

**gateway → 扩展：**

```jsonc
{ "type": "request", "id": "r1", "method": "page.click", "params": { "ref": "@e1" } }
{ "type": "pong" }

// 握手通过后立即下发（重连即重发）：--allow-url 的正则源码；空数组 = 不限制
{ "type": "allowlist", "patterns": ["^https://example\\.com/"] }
```

## 会话规则

- hello 鉴权失败 → close `4003`；协议版本不符 → close `4002`；browserId 非法（不在 `[A-Za-z0-9_-]{1,64}` 内）→ close `4004`；
- 多浏览器：按 `browserId` 分流——同一 browserId 新连接顶替旧连接（close `1000`），不同 browserId 并存；
- MCP 侧经 `/mcp/:browserId` 路径绑定目标浏览器；relay 模式下每个请求还需 `Authorization: Bearer <token>`；
- gateway 为每个请求设超时（snapshot/evaluate 30s、navigate 20s、其余 10-15s），超时返回 `timeout`，浏览器离线返回 `browser_disconnected`；
- gateway 除响应请求外，只在握手通过后主动推送一条 `allowlist`（导航兜底用；重连自动重发）；扩展除 `result`/`ping` 外会上报 `nav_blocked`；
- 版本升级约定：新增消息类型必须升 `PROTOCOL_VERSION`（hello 校验会拒旧客户端）。v2 = 新增 `allowlist` / `nav_blocked`，旧扩展连新版 gateway 被 close `4002`（fail-closed：宁可连不上，也不静默丢掉导航门禁）。

## 方法集

`ping` / `tabs.list` / `tabs.get` / `tabs.create` / `tabs.close` / `tabs.activate` / `tabs.navigate` / `tabs.screenshot` / `page.snapshot` / `page.click` / `page.fill` / `page.type` / `page.press` / `page.scroll` / `page.evaluate`

完整参数/结果类型以 [`packages/protocol/src/methods.ts`](https://github.com/jeffkit/browser-bridge/blob/main/packages/protocol/src/methods.ts) 为权威定义；错误码见 [`packages/protocol/src/errors.ts`](https://github.com/jeffkit/browser-bridge/blob/main/packages/protocol/src/errors.ts)。

## 与 MCP 层的对应

MCP 工具几乎一一映射到线协议方法（`browser_click` → `page.click`），并在网关侧多做三件事：权限档与 owner 校验（`--permission` / `--allow-foreign-tabs` → `permission_denied` / `tab_not_owned`）、`--allow-url` 校验（参数入口 + `allowlist` 下发做导航兜底）、页面内容不可信标记（`untrusted` + delimiter）。默认超时注入与错误码转 Agent 可读文本（含排查提示）同样在此层。见 `packages/gateway/src/mcp/tools.ts`。

## 演进

协议按 transport 分层设计：扩展侧只依赖「WS URL + token」，工具层只依赖 hub 抽象。未来新增公网 relay（双方都出站连中转）或多浏览器路由时，消息形状不变，`proto` 升号管理兼容。
