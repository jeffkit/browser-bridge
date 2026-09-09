# FAQ / 故障排查

## 连接问题

### popup 一直黄点（连接中）

1. gateway 起了吗？Agent 机器上 `curl http://127.0.0.1:17833/healthz`；
2. 地址填对了吗？扩展里填的是「**本地能访问到的** gateway 地址」（注意不是 127.0.0.1，除非 gateway 就在本机）；
3. 端口通吗？本地 `nc -vz <host> 17833`，不通查防火墙 / 安全组；
4. token 改过吗？token 不匹配会慢退避重连（30s 一次），popup 变红并显示 `code=4003`。

### `browser_disconnected`

扩展侧掉线。最常见：浏览器刚重启、扩展被浏览器禁用、电脑休眠。恢复网络后扩展会自动重连（指数退避，最长 30s 一跳），也可以点一下 popup 手动触发（弹出即唤醒 service worker）。

### 连上几分钟后就断

Chrome < 116 的 service worker 休眠策略不同，请升级到 Chrome/Edge ≥ 116。

## 页面操作问题

### `stale_ref` 频繁出现

正常现象：页面跳转/刷新后 `@eN` 引用全部重编。重新 `browser_snapshot` 再操作。单页应用（SPA）内切换若不触发导航，引用仍然有效。

### `page_not_injectable`

`chrome://` 设置页、Chrome Web Store、浏览器 PDF 查看器等受限页面禁止注入，无解——换普通网页（http/https）。

### 点击没反应

部分站点校验事件 `isTrusted`（合成点击为 false）或有人机验证。可尝试：先 `browser_snapshot` 确认元素仍存在 → 直接点按钮元素而非外层容器 → 绕过 UI 用 `browser_evaluate` 调页面接口。

### `browser_fill` 后 React/Vue 表单没反应

bridge 已按受控组件方式派发 `input`/`change` 事件；若仍无效，说明站点监听的是原生键盘事件，改用 `browser_click` 聚焦 + `browser_type` 逐字符输入。

## 截图问题

### `screenshot_failed`

`captureVisibleTab` 只能截**可见**窗口：确认浏览器窗口没有全部最小化。指定非活跃 `tabId` 时扩展会自动切换前台再截，多标签会闪一下属正常。

## 部署问题

### gateway 部署在公网安全吗？

用 `wss://`（反代 TLS）+ 固定 token 是可以接受的；**明文 `ws://` 公网部署不行**。详见[安全](/guide/security)。

### Agent 连不上 `/mcp`

`/mcp` 与扩展 WS 同端口。确认 `curl http://<host>:17833/healthz` 通；确认 MCP 客户端用的是 streamable HTTP 方式且 URL 以 `/mcp` 结尾；初次握手必须是 `initialize` 请求（标准 MCP 客户端自动处理）。

### 双方都在 NAT 后怎么办

用 Tailscale / WireGuard 组网后按内网方式连，或部署 [relay](/guide/relay)（公网中转，扩展与 Agent 都出站连接）。

### relay 返回 401

MCP 请求缺 `Authorization: Bearer <token>` 或 token 不在 relay 注册表内。另外注意：**浏览器在线时，Bearer 必须是它握手用的那个 token**——用 A 的 token 去连 B 浏览器的 `/mcp/<id>` 会被拒。

### 连错浏览器（多浏览器场景）

MCP URL 的路径决定目标：`/mcp` 是 default，`/mcp/laptop` 是浏览器 ID 为 `laptop` 的设备。用 `browser_status` 的 `browsers` 字段核对在线设备名。

## 其他

### 和 Playwright / browser-use 什么关系？

Playwright 驱动的是它自己拉起的浏览器实例；browser-bridge 操控的是**你正在用的真实浏览器**（带你的登录态、扩展、Profile）。远程 Agent + 真人共用一台浏览器的场景，本工具更合适。

### 数据流经第三方吗？

不经。链路只有两段：扩展 ↔ gateway（你的机器）、gateway ↔ Agent（你的机器）。本项目不收集任何数据。
