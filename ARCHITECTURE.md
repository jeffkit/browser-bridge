# browser-bridge 架构

> 最后更新：2026-09-09（v0.1 初版）

## 1. 组件

```
packages/
├── protocol/   线协议（零依赖，双方共享）
├── gateway/    Node 服务（npm: browser-bridge-gateway）
│   ├── hub.ts        BrowserHub：WS server + hello 鉴权 + 会话顶替 + /healthz + /mcp 挂载点
│   ├── session.ts    BrowserSession：请求关联（id ↔ pending）、超时、断开传播
│   ├── cli.ts        serve（WS + streamable HTTP MCP）/ mcp（WS + stdio MCP）/ token
│   └── mcp/
│       ├── tools.ts  14 个 browser_* 工具定义（zod schema + handler + 错误提示）
│       ├── server.ts McpServer 装配（每 MCP 会话一实例，共享 hub）
│       └── http.ts   streamable HTTP stateful 会话管理
└── extension/  Chrome/Edge MV3 扩展（esbuild → dist-extension/）
    ├── service-worker/
    │   ├── connection.ts  出站 WS：hello / 心跳 20s / 指数退避重连（1s→30s）/ 配置热更新
    │   ├── router.ts      method 分发：tabs.* 直调 chrome.*；page.* 经 content script；
    │   │                  page.evaluate 直接 chrome.scripting（支持 MAIN world）
    │   └── index.ts       生命周期 + popup 状态查询
    ├── content/           动态注入（ISOLATED world）：@eN 快照与交互
    └── popup/ options/    状态显示 / gateway URL + token 配置
```

## 2. 数据流

```
MCP 客户端 ── tools/call browser_click ──▶ McpServer(handler)
   └▶ BrowserSession.request("page.click", params)   （生成 id，挂 pending，超时 15s）
        └─ WS: {"type":"request","id","method","params"} ──▶ 扩展 service worker
             └─ router.dispatch → ensureInjected（bb-probe / executeScript）
                  └─ chrome.tabs.sendMessage(bb-request) ──▶ content script
                       └─ resolveElement(@eN) → dispatchEvent → 应答
响应原路返回：content → SW → {"type":"result","id","ok","result|error"} → settle pending → MCP content
```

## 3. 关键决策

| 决策 | 理由 |
|------|------|
| 扩展出站 WS，gateway 不做 TLS | 扩展无法监听端口；TLS 交给 caddy/nginx/Tailscale，gateway 保持极简 |
| 协议形状沿用 web-bridge（`{id,method,params}` / `{id,ok,result\|error}`） | 大仓内「页面操控」双仓心智一致 |
| `@eN` 引用 + content script 内缓存 | 快照输出省 token；交互免传选择器；导航后缓存随注入重建自然失效 |
| MCP 双入口（streamable HTTP + stdio） | 远程 agent 用 HTTP；同机 agent 在 mcp_servers 里直接拉起，同进程内转发零跨进程桥 |
| 每 MCP 会话一个 McpServer 实例 | SDK stateful 模式惯例；工具 handler 共享同一 hub，实例间无状态漂移 |
| 扩展应用层心跳 20s | Chrome ≥116 下 WS 活动重置 SW idle timer，防 service worker 休眠断连 |
| 导航等待轮询 readyState 而非 webNavigation | 免加权限；`load`/`domcontentloaded` 分别对应 `complete`/`≥interactive` |
| `page.evaluate` 不经 content script | MAIN world 无法与 ISOLATED content script 通信，必须由 SW 直接 executeScript |
| v1 单浏览器会话（新连顶替旧） | 目标场景「我的浏览器 + 我的 agent」；多浏览器路由留给 relay 演进 |

## 4. 错误码契约

扩展与 gateway 共用 protocol 的 `ErrorCode`：`auth_failed` / `browser_disconnected` / `timeout` / `method_not_found` / `bad_params` / `tab_not_found` / `screenshot_failed` / `navigation_timeout` / `page_not_injectable` / `page_action_failed` / `stale_ref` / `url_not_allowed` / `internal`。`ErrorCodeHints` 提供面向 agent 的排查提示，随 MCP 工具错误文本返回。

## 5. 扩展点（未实现，接口已留）

- **公网 relay**：双方都出站连 relay 的拓扑。hub 的会话抽象（token ↔ session）与工具层（只依赖 hub）不感知传输拓扑，新增 relay 即第三种部署形态，协议不变。
- **多浏览器会话**：session 已有独立 id，路由层可按 browserId 分流。
- **Firefox**：MV3 大体兼容；`browser.*` 命名空间需构建期适配。

## 6. 测试

- `packages/gateway/test/`：hub 集成测（鉴权/往返/超时/断开/顶替/心跳/allow-url）+ streamable HTTP 冒烟 + stdio 冒烟（spawn dist/cli.js）。
- `scripts/smoke.mjs`：真实 gateway 进程 + 假扩展 + MCP HTTP 全链路（含 allow-url 拦截）。
- 扩展端手工验收清单见 README（MV3 扩展自动化 E2E 收益低，v1 不做）。
