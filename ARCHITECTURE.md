# browser-bridge 架构

> 最后更新：2026-09-09（v0.2：多浏览器会话、公网 relay、Firefox 支持）

## 1. 组件

```
packages/
├── protocol/   线协议（零依赖，双方共享）
├── gateway/    Node 服务（npm: browser-bridge-gateway）
│   ├── hub.ts        BrowserHub：WS server + hello 鉴权 + 多浏览器路由（browserId）
│   │                 同 ID 顶替 / 跨 ID 并存；/healthz 报告在线浏览器数
│   ├── session.ts    BrowserSession：请求关联（id ↔ pending）、超时、断开传播、携带配对 token
│   ├── cli.ts        serve（WS + streamable HTTP）/ mcp（WS + stdio，绑 default）
│   │                 relay（公网中转：多 token 注册表 + MCP 强制 Bearer + 槽位绑定）/ token
│   └── mcp/
│       ├── tools.ts  14 个 browser_* 工具（zod schema + handler，绑定 {hub, browserId} 目标）
│       ├── server.ts McpServer 装配：createMcpServer(hub, browserId)，每 MCP 会话一实例
│       └── http.ts   streamable HTTP：/mcp → default、/mcp/:browserId → 对应浏览器；
│                     authenticate 钩子（relay 用）+ bearerToken 提取
└── extension/  浏览器扩展（esbuild 双产物）
    ├── service-worker/
    │   ├── connection.ts  出站 WS：hello（含 browserId）/ 心跳 20s / 指数退避重连 / 配置热更新
    │   ├── router.ts      method 分发：tabs.* 直调 api.tabs.*；page.* 经 content script；
    │   │                  page.evaluate 直接 api.scripting（支持 MAIN world）
    │   └── index.ts       生命周期 + popup 状态查询
    ├── content/           动态注入（ISOLATED world）：@eN 快照与交互
    ├── common/api.ts      browser.*（Firefox）/ chrome.*（Chromium）适配层
    └── popup/ options/    状态显示 / gateway URL + token + 浏览器 ID 配置
    产物：dist-extension/（Chromium，manifest.json，SW 为 ESM）
         dist-extension-firefox/（manifest.firefox.json，事件页 background.scripts，全 IIFE）
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
| 每 MCP 会话一个 McpServer 实例，绑定 browserId | SDK stateful 模式惯例；`/mcp/:browserId` 路径即浏览器选择器，工具面完全不变 |
| 多浏览器按 browserId 路由（同 ID 顶替、跨 ID 并存） | 一台 gateway/relay 管多台设备；browserId 白名单字符保证 URL 路径安全 |
| relay = gateway 的公网部署形态（serve 命令的超集） | 复用同一套 hub/工具/协议；差异只在多 token 注册表 + MCP 强制 Bearer + 槽位绑定 |
| 扩展应用层心跳 20s | Chrome ≥116 下 WS 活动重置 SW idle timer，防 service worker 休眠断连 |
| 导航等待轮询 readyState 而非 webNavigation | 免加权限；`load`/`domcontentloaded` 分别对应 `complete`/`≥interactive` |
| `page.evaluate` 不经 content script | MAIN world 无法与 ISOLATED content script 通信，必须由 SW 直接 executeScript |
| Firefox 用 browser.* 适配层 + 事件页 IIFE | Firefox 的 chrome.* 是回调风格、MV3 无 service_worker；同一源码经 api.ts 适配、构建期换 manifest 与打包格式 |

## 4. 错误码契约

扩展与 gateway 共用 protocol 的 `ErrorCode`：`auth_failed` / `browser_disconnected` / `timeout` / `method_not_found` / `bad_params` / `tab_not_found` / `screenshot_failed` / `navigation_timeout` / `page_not_injectable` / `page_action_failed` / `stale_ref` / `url_not_allowed` / `internal`。`ErrorCodeHints` 提供面向 agent 的排查提示，随 MCP 工具错误文本返回。

## 5. 部署形态（原「扩展点」，v0.2 已实现）

| 形态 | 命令 | 场景 |
|------|------|------|
| 直连 gateway | `serve` | Agent 机可达（公网 IP / 内网 / Tailscale），单/多浏览器 |
| 同机 stdio | `mcp` | Agent 与 gateway 同机，由 Agent 拉起 |
| 公网 relay | `relay` | 双方都在 NAT 后或多浏览器集中管理；多 token 注册表 + MCP 强制 Bearer + 浏览器槽位绑定其配对 token |

协议在三种形态间不变：扩展侧只依赖「WS URL + token + browserId」，工具层只依赖 `{hub, browserId}` 目标抽象。

## 6. 测试

- `packages/gateway/test/`：hub 集成测（鉴权/往返/超时/断开/顶替/心跳/allow-url/非法 browserId/多浏览器路由）+ streamable HTTP 冒烟（路径绑定/401 鉴权）+ stdio 冒烟（spawn dist/cli.js）。
- `scripts/smoke.mjs`：真实 gateway 进程 + 双假扩展（default + laptop）+ MCP HTTP 全链路（含 allow-url 拦截与 `/mcp/laptop` 路由）。
- Firefox 端：构建产物验证 + 手工验收（临时载入、权限授予）；自动化 E2E 收益低，v1 不做。
