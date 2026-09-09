# AGENTS.md — browser-bridge

> 远程 Agent ↔ 本地浏览器桥：Chrome/Edge MV3 扩展 + MCP gateway。
> 负责人：jeffkit | 创建：2026-09-09

## 项目概述

Agent 跑在远程机器上，经标准 MCP 连本仓 gateway；gateway 经出站 WebSocket 驱动本地浏览器里的扩展，执行导航/快照/点击输入/截图/执行 JS。与 web-bridge 呼应成对（web-bridge 操控桌面 WebView，本仓操控真实浏览器），协议形状一致（`{id, method, params}` / `{id, ok, result|error}` + `@eN` 引用）。

**技术栈：** TypeScript, pnpm workspace, esbuild, ws, MCP SDK, zod, vitest
**主仓库：** `git@github.com:jeffkit/browser-bridge.git`

## 架构地图

```
packages/protocol    线协议（消息/方法/错误码/browserId 规则，双方共享，零依赖）
packages/gateway     browser-bridge-gateway：WS server（多浏览器路由）+ MCP（streamable HTTP / stdio）+ CLI（serve/mcp/relay/token）
packages/extension   浏览器扩展：service worker（连接/路由）+ content script（快照/交互）+ popup/options；api.ts 适配 Chromium/Firefox，双产物构建
scripts/smoke.mjs    端到端冒烟（双浏览器路由）
```

依赖方向：`gateway → protocol`、`extension → protocol`，两包互不依赖。

关键路径：
- `packages/protocol/src/methods.ts` — 全部方法与参数/结果类型（改协议先改这里）
- `packages/protocol/src/errors.ts` — 错误码与 agent 排查提示；`messages.ts` — hello.browserId / BROWSER_ID_PATTERN
- `packages/gateway/src/hub.ts` — WS 鉴权/多浏览器路由；`src/mcp/tools.ts` — 工具面；`src/mcp/http.ts` — /mcp/:browserId 与 Bearer
- `packages/extension/src/service-worker/router.ts` — 方法→chrome API 分发
- `packages/extension/src/content/snapshot.ts` — @eN 快照算法；`common/api.ts` — browser.* 适配层

## 开发约定

**分支策略：** dev/test/prod 均 main。

**禁止事项：**
- 禁止改协议不升 `PROTOCOL_VERSION`（hello 校验会拒旧客户端）
- 禁止在 stdio MCP 模式下向 stdout 打日志（stdout 是 MCP 通道；日志一律 stderr）
- 禁止在 content script 处理 `page.evaluate`（MAIN world 需求必须走 SW executeScript）
- 禁止绕过 token 鉴权；relay 模式的 MCP 必须保持强制 Bearer + 浏览器槽位绑定
- 禁止扩展源码直接引用 `chrome.*` 运行时 API（一律经 `common/api.ts` 适配层，保证 Firefox 兼容）
- 禁止放行 browserId 白名单 `[A-Za-z0-9_-]{1,64}` 之外的取值（它进 URL 路径）

## 常用命令

```bash
pnpm install
pnpm build                      # protocol → gateway → extension（Chromium + Firefox 双产物）
pnpm test                       # gateway 测试（自动先 build）
pnpm typecheck
node scripts/smoke.mjs          # 端到端冒烟
npx browser-bridge-gateway serve --token <t>   # 直连模式（或 node packages/gateway/dist/cli.js）
npx browser-bridge-gateway relay --token a --token b   # 公网中转模式
# 加载扩展：chrome://extensions → 开发者模式 → 加载 dist-extension/
# Firefox：about:debugging → 临时载入 dist-extension-firefox/manifest.json
```

## 当前状态

v0.2：协议 15 方法 + browserId 多浏览器路由；MCP 14 工具、三部署形态（serve / mcp / relay）；扩展 Chromium + Firefox 双产物；gateway 测试 18 项 + 端到端冒烟（含双浏览器）全绿。未实现：扩展自动化 E2E、npm 发布（当前源码安装）。

## 深入阅读

| 文档 | 说明 |
|------|------|
| `README.md` | 快速开始 / 安全模型 / 验收清单 |
| `ARCHITECTURE.md` | 组件、数据流、关键决策、扩展点 |
| `packages/protocol/src` | 协议权威定义 |
