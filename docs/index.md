---
layout: home

hero:
  name: browser-bridge
  text: 远程 Agent ↔ 本地浏览器桥
  tagline: Chrome/Edge MV3 扩展 + MCP gateway。你的 Agent 跑在远程机器上，经标准 MCP 操控你本地的真实浏览器——导航、快照、点击输入、截图、执行脚本。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/install
    - theme: alt
      text: 了解架构
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/jeffkit/browser-bridge

features:
  - icon: 🌐
    title: 远程可达，本地零暴露
    details: 扩展只做出站 WebSocket 连接，本地机器无需开放任何入站端口；公网 IP、端口转发、Tailscale 皆可。
  - icon: 🔌
    title: 标准 MCP，Agent 零适配
    details: gateway 提供 MCP streamable HTTP（远程 agent）与 stdio（同机 agent）双入口，recursive / claude-code / codex 等 MCP 客户端即插即用。
  - icon: 🎯
    title: "@eN 引用，快照即操控"
    details: browser_snapshot 输出可访问性骨架并为可交互元素编号，点击、填入、按键直接引用 @eN，省 token 也免写选择器。
  - icon: 🔒
    title: token 鉴权 + URL 允许列表
    details: 握手 token 不匹配即断连；--allow-url 正则限制 Agent 可导航的站点；传输加密交给 wss / Tailscale。
  - title: ""
    icon: 📸
    details: 截图直接以图片内容返回给多模态 Agent，页面执行 JS 支持 ISOLATED 与 MAIN 两个世界。
  - icon: 🧩
    title: 与 web-bridge 同心智
    details: "协议形状与 web-bridge 一致（{id, method, params} + @eN）——web-bridge 操控桌面 WebView，browser-bridge 操控真实浏览器。"
---
