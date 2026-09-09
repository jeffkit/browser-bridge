# 介绍

browser-bridge 让运行在**远程机器**上的 AI Agent 操控你**本地浏览器**（Chrome / Edge）。

典型场景：Agent 在云端跑任务，需要用「你」的浏览器——带你已登录的站点、你的 Cookie、你的插件环境。Agent 通过标准 MCP 连接 gateway，gateway 通过一条由浏览器扩展主动发起的出站 WebSocket 长连接下发指令。

## 架构

```
本地机器（可在 NAT 后）                          远程 agent 机器
┌─ Chrome/Edge (≥116) ─────────┐               ┌──────────────────────────┐
│  browser-bridge 扩展          │               │  Agent（MCP 客户端）       │
│   ├ service worker           │  wss 出站      │      │                    │
│   │    └ WS 长连接 ━━━━━━━━━━━│━━━━━━━━━━━━━━▶│  browser-bridge-gateway   │
│   ├ content script（按需注入） │               │   ├ WS server（接扩展）     │
│   └ popup / options          │               │   └ MCP server（HTTP/stdio）│
└──────────────────────────────┘               └──────────────────────────┘
```

三个组成部分：

| 组件 | 仓库位置 | 说明 |
|------|---------|------|
| **扩展** | `packages/extension` | 装在本地 Chrome/Edge，只做出站连接，负责执行浏览器操作 |
| **gateway** | `packages/gateway` | 跑在 Agent 机器上（npm 包 `browser-bridge-gateway` 源码安装），一边接扩展、一边暴露 MCP |
| **协议** | `packages/protocol` | 两端共享的线协议定义（TypeScript） |

## 关键设计

- **本地零暴露**：浏览器扩展无法监听端口，因此由扩展**主动出站**连 gateway。你的电脑不开任何入站端口，唯一前提是「本地能访问 gateway 所在机器的端口」。
- **标准 MCP**：Agent 侧不需要任何专属 SDK——凡是 MCP 客户端（recursive、claude-code、codex、Cursor 等）都能直接用。
- **快照即操控**：`browser_snapshot` 返回页面的可访问性骨架，可交互元素被编号为 `@e1`、`@e2`…，后续 `browser_click @e12` 直接引用，无需 CSS 选择器。
- **与 web-bridge 呼应**：协议形状与 [web-bridge](https://github.com/jeffkit/web-bridge) 一致——那边操控 Electron/Tauri 桌面 WebView，这边操控真实浏览器。

## 适合与不适合

**适合**：远程 Agent 需要用你本地登录态操作网页、人机共用一台浏览器、内网系统自动化。

**不适合**：无头大规模爬取（用 Playwright 更合适）、完全无人值守的高敏感操作（本工具默认给 Agent 全操控权限，请配合「安全」章节的允许列表使用）。

下一步：[安装](./install)。
