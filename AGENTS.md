# AGENTS.md — browser-bridge

> 远程 Agent ↔ 本地浏览器桥：Chrome/Edge MV3 扩展 + MCP gateway。
> 负责人：jeffkit | 创建：2026-09-09

## 项目概述

Agent 跑在远程机器上，经标准 MCP 连本仓 gateway；gateway 经出站 WebSocket 驱动本地浏览器里的扩展，执行导航/快照/点击输入/截图/执行 JS。与 web-bridge 呼应成对（web-bridge 操控桌面 WebView，本仓操控真实浏览器），协议形状一致（`{id, method, params}` / `{id, ok, result|error}` + `@eN` 引用）。

**技术栈：** TypeScript, pnpm workspace, esbuild, ws, MCP SDK, zod, vitest
**主仓库：** `git@github.com:jeffkit/browser-bridge.git`

## 架构地图

```
packages/protocol    线协议（消息/方法/错误码，双方共享，零依赖）
packages/gateway     browser-bridge-gateway：WS server + MCP（streamable HTTP / stdio）+ CLI
packages/extension   MV3 扩展：service worker（连接/路由）+ content script（快照/交互）+ popup/options
scripts/smoke.mjs    端到端冒烟
```

依赖方向：`gateway → protocol`、`extension → protocol`，两包互不依赖。

关键路径：
- `packages/protocol/src/methods.ts` — 全部方法与参数/结果类型（改协议先改这里）
- `packages/protocol/src/errors.ts` — 错误码与 agent 排查提示
- `packages/gateway/src/hub.ts` — WS 鉴权/会话顶替；`src/mcp/tools.ts` — 工具面
- `packages/extension/src/service-worker/router.ts` — 方法→chrome API 分发
- `packages/extension/src/content/snapshot.ts` — @eN 快照算法

## 开发约定

**分支策略：** dev/test/prod 均 main。

**禁止事项：**
- 禁止改协议不升 `PROTOCOL_VERSION`（hello 校验会拒旧客户端）
- 禁止在 stdio MCP 模式下向 stdout 打日志（stdout 是 MCP 通道；日志一律 stderr）
- 禁止在 content script 处理 `page.evaluate`（MAIN world 需求必须走 SW executeScript）
- 禁止绕过 token 鉴权或给 ws:// 明文模式添加公网部署指引（TLS 归部署侧，文档要写清）

## 常用命令

```bash
pnpm install
pnpm build                      # protocol → gateway → extension
pnpm test                       # gateway 测试（自动先 build）
pnpm typecheck
node scripts/smoke.mjs          # 端到端冒烟
npx browser-bridge-gateway serve --token <t>   # 起服务（或 node packages/gateway/dist/cli.js）
# 加载扩展：chrome://extensions → 开发者模式 → 加载 packages/extension/dist-extension
```

## 当前状态

v0.1：协议 15 方法、MCP 14 工具、gateway 双入口、扩展四件套（SW/content/popup/options）；gateway 测试 13 项 + 端到端冒烟全绿；扩展端手工验收清单见 README。未实现：公网 relay、多浏览器会话、Firefox。

## 深入阅读

| 文档 | 说明 |
|------|------|
| `README.md` | 快速开始 / 安全模型 / 验收清单 |
| `ARCHITECTURE.md` | 组件、数据流、关键决策、扩展点 |
| `packages/protocol/src` | 协议权威定义 |
