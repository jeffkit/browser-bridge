# browser-bridge 架构

> 最后更新：2026-09-09（当前 0.3.2：多浏览器会话、公网 relay、Firefox 支持）

## 1. 组件

```
packages/
├── protocol/   线协议（零依赖，双方共享）
├── gateway/    Node 服务（npm: browser-bridge-gateway）
│   ├── hub.ts        BrowserHub：WS server + hello 鉴权 + 多浏览器路由（browserId）
│   │                 同 ID 顶替 / 跨 ID 并存；/healthz 报告在线浏览器数
│   ├── session.ts    BrowserSession：请求关联（id ↔ pending）、超时、断开传播、携带配对 token
│   │                 本会话 owner 集合（ownedTabs）与导航拦截记录（navBlocks）
│   ├── cli.ts        serve（WS + streamable HTTP）/ mcp（WS + stdio，绑 default）
│   │                 relay（公网中转：多 token 注册表 + MCP 强制 Bearer + 槽位绑定）/ token
│   │                 动作面策略参数：--permission（默认 read-only）/ --allow-foreign-tabs
│   └── mcp/
│       ├── tools.ts  14 个 browser_* 工具（zod schema + handler，绑定 {hub, browserId} 目标）
│       │             统一门禁包装：档位（minTier → permission_denied）+ owner（ownerScoped → tab_not_owned）
│       │             另做 --allow-url 入参校验、snapshot/evaluate 不可信标记
│       ├── server.ts McpServer 装配：createMcpServer(hub, browserId)，每 MCP 会话一实例
│       └── http.ts   streamable HTTP：/mcp → default、/mcp/:browserId → 对应浏览器；
│                     authenticate 钩子（relay 用）+ bearerToken 提取
└── extension/  浏览器扩展（esbuild 双产物）
    ├── service-worker/
    │   ├── connection.ts  出站 WS：hello（含 browserId）/ 心跳 20s / 指数退避重连 / 配置热更新
    │   │                  收 allowlist 下发；send() 供 nav_blocked 上报
    │   ├── nav-guard.ts   导航兜底：tabs.onUpdated 拦 owned tab 的越界导航（回退 + 上报）
    │   ├── router.ts      method 分发：tabs.* 直调 api.tabs.*；page.* 经 content script；
    │   │                  page.evaluate 直接 api.scripting（支持 MAIN world）；
    │   │                  navigate/create 成功后登记 owned tab 与最后允许 URL
    │   └── index.ts       生命周期 + popup 状态查询 + navGuard.install/上报接线
    ├── content/           动态注入（ISOLATED world）：@eN 快照与交互
    ├── common/api.ts      browser.*（Firefox）/ chrome.*（Chromium）适配层
    └── popup/ options/    状态显示 / gateway URL + token + 浏览器 ID 配置
    产物：dist-extension/（Chromium，manifest.json，SW 为 ESM）
         dist-extension-firefox/（manifest.firefox.json，事件页 background.scripts，全 IIFE）
```

## 2. 数据流

```
MCP 客户端 ── tools/call browser_click ──▶ McpServer(handler)
   └▶ tools.ts 门禁：档位（--permission）→ owner（ownedTabs）→ --allow-url 入参校验
      └▶ BrowserSession.request("page.click", params)   （生成 id，挂 pending，超时 15s）
           └─ WS: {"type":"request","id","method","params"} ──▶ 扩展 service worker
                └─ router.dispatch → ensureInjected（bb-probe / executeScript）
                     └─ chrome.tabs.sendMessage(bb-request) ──▶ content script
                          └─ resolveElement(@eN) → dispatchEvent → 应答
响应原路返回：content → SW → {"type":"result","id","ok","result|error"} → settle pending → MCP content
（snapshot/evaluate 的结果在 tools.ts 打上 untrusted 标记后进入 agent 上下文）

导航兜底回路（--allow-url 非空时）：
gateway hello 通过 ── WS allowlist{patterns} ──▶ 扩展 navGuard（owned tab 才生效）
页面自发跳转（点链接/表单/JS location）──▶ tabs.onUpdated → 越界则 tabs.update 回退 ──┐
                                                                                     │
        browser_status.navBlocked ◀── session.navBlocks ◀── WS nav_blocked ◀─────────┘
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
| 导航兜底放扩展侧 `tabs.onUpdated`（gateway 经新消息下发 allowlist） | 门禁必须在导航实际发生处：gateway 事后复核有竞态窗口且看不到页面自发跳转；`tabs` 权限已有（`webNavigation` 要加权限，与免加权限决策冲突）。代价是新协议消息 → `PROTOCOL_VERSION` 1→2，旧扩展被 4002 拒连（fail-closed） |
| 动作面默认最窄档（`--permission` 缺省 `read-only`） | 最小权限默认成立：新增能力（evaluate/交互）必须显式开档，`--permission` 非法值直接启动失败而非静默回退 |
| owner 状态放 gateway（BrowserSession.ownedTabs）而非扩展 | 扩展 SW 每次唤醒都重跑顶层代码、内存态不可持久（现有 SW 已是如此），放 gateway 才与连接生命周期一致 |
| 页面内容不可信标记放 gateway（tools.ts）而非扩展/序列化层 | 一处收口、不动扩展结果契约；`value`/`nodes` 保持原形，只用 delimiter + `untrusted: true` 标记 |
| `page.evaluate` 不经 content script，动态 fn 经 MAIN world eval 还原 | MAIN world 无法与 ISOLATED content script 通信；MV3 扩展 CSP 禁 eval（SW 与 ISOLATED 均拦），仅 MAIN（页面 CSP 管辖）可执行动态源码 |
| Firefox 用 browser.* 适配层 + 事件页 IIFE | Firefox 的 chrome.* 是回调风格、MV3 无 service_worker；同一源码经 api.ts 适配、构建期换 manifest 与打包格式 |

## 4. 错误码契约

扩展与 gateway 共用 protocol 的 `ErrorCode`：`auth_failed` / `browser_disconnected` / `timeout` / `method_not_found` / `bad_params` / `tab_not_found` / `screenshot_failed` / `navigation_timeout` / `page_not_injectable` / `page_action_failed` / `stale_ref` / `url_not_allowed` / `permission_denied` / `tab_not_owned` / `internal`。`ErrorCodeHints` 提供面向 agent 的排查提示（含该加哪个 `--permission` 档 / `--allow-foreign-tabs`），随 MCP 工具错误文本返回。

线协议版本：`PROTOCOL_VERSION`（protocol/messages.ts）v2 = `allowlist`（gateway→扩展，导航兜底允许列表）+ `nav_blocked`（扩展→gateway，拦截上报）。改协议必须升版本号：hello 会拒旧客户端（fail-closed）。

## 5. 部署形态（原「扩展点」，现已实现）

| 形态 | 命令 | 场景 |
|------|------|------|
| 直连 gateway | `serve` | Agent 机可达（公网 IP / 内网 / Tailscale），单/多浏览器 |
| 同机 stdio | `mcp` | Agent 与 gateway 同机，由 Agent 拉起 |
| 公网 relay | `relay` | 双方都在 NAT 后或多浏览器集中管理；多 token 注册表 + MCP 强制 Bearer + 浏览器槽位绑定其配对 token |

协议在三种形态间不变：扩展侧只依赖「WS URL + token + browserId」，工具层只依赖 `{hub, browserId}` 目标抽象。

## 6. 测试

- `packages/gateway/test/`：hub 集成测（鉴权/往返/超时/断开/顶替/心跳/allow-url/非法 browserId/多浏览器路由/allowlist 下发/nav_blocked 记录）+ 动作面策略（`issue3-permission-tiers.test.ts`：档位与 owner、不可信标记）+ 扩展导航守卫单测（`nav-guard.test.ts`，跨包直接驱动扩展源码）+ streamable HTTP 冒烟（路径绑定/401 鉴权）+ stdio 冒烟（spawn dist/cli.js）+ `call` 子命令冒烟。
- `scripts/smoke.mjs`：真实 gateway 进程 + 双假扩展（default + laptop）+ MCP HTTP 全链路（含 allow-url 拦截、档位 `permission_denied` 与 `/mcp/laptop` 路由）。
- `scripts/e2e.mjs`：Playwright 加载真实扩展跑全链路（`--permission full`）。
- Firefox 端：构建产物验证 + 手工验收（临时载入、权限授予）；自动化 E2E 收益低，v1 不做。
