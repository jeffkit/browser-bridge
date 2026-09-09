# 安全

browser-bridge 赋予 Agent 对你浏览器的**全操控**权限（读页面、点按钮、执行脚本、截图）。使用前请理解下面的模型。

## 鉴权

- 扩展与 gateway 之间用 **pairing token** 鉴权：扩展每次连接的第一条 hello 消息携带 token，不匹配立即断开（WS close code 4003），并且进入 30 秒慢退避。
- token 存在两处：扩展的本地存储（`chrome.storage.local`）与 gateway 进程参数。**不要把 token 提交进代码仓库或贴在公开渠道**。
- gateway 未显式提供 token 时会随机生成一个并打印在日志里——重启即换，适合试跑，不适合长期使用。

## 传输加密

gateway 自身**不做 TLS 终结**，传输安全由部署方式决定：

| 方案 | 加密 | 适用 |
|------|------|------|
| `ws://` 直连 | ❌ 明文 | 仅限可信内网 / 本机 |
| Tailscale / WireGuard | ✅ 隧道加密 | 推荐，零配置 |
| caddy / nginx 反代 + `wss://` | ✅ TLS | 公网部署必须 |

公网明文 `ws://` 等于把浏览器操控权暴露给整条链路上的窃听者，请勿使用。

## 最小权限：--allow-url

给 gateway 启动加允许列表，Agent 的 `browser_navigate` / `browser_tab_open` 就只能去允许的站点：

```bash
node packages/gateway/dist/cli.js serve --token <t> \
  --allow-url '^https://(github\.com)/' \
  --allow-url '^https://.*\.corp\.example\.cn/'
```

越界导航返回 `url_not_allowed` 错误。注意：允许列表只约束「导航目标」；Agent 仍可在已打开页面上执行 `browser_evaluate`，所以请同时确保 token 不外泄。

## 浏览器权限

扩展申请的 Chrome 权限：

| 权限 | 用途 |
|------|------|
| `tabs` | 列出/切换标签页、截图 |
| `scripting` | 向页面注入快照与交互脚本、执行 Agent 提供的 JS |
| `storage` | 保存 gateway 地址与 token |
| `<all_urls>` | 在任意页面注入与交互（安装时的全域警告即来源于此） |

## 其他边界

- **单浏览器会话**：同一 token 的新扩展连接会顶替旧连接（防重放抢占比旧连接更糟的抢占问题）；Agent 请求期间扩展断开会收到明确的 `browser_disconnected`。
- **无审批流**：当前版本 Agent 的操作不会向你二次确认。若任务敏感，建议敏感站点不放行（用 `--allow-url`），或人在旁边时才启动 gateway。
- **最小暴露面**：gateway 的 MCP 端点 `/mcp` 没有独立鉴权（依赖网络边界）。不要把它暴露给不可信网络；需要时用反代加 IP 白名单或 mTLS。

## 一句话建议

> 用 Tailscale 或 wss，用固定 token，用 `--allow-url` 圈定站点，gateway 只在你信任的网络里开。
