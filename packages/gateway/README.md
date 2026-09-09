# browser-bridge-gateway

远程 Agent ↔ 本地浏览器桥的 **gateway** 侧：一边经 WebSocket 承载本地浏览器扩展（Chrome/Edge/Firefox）的出站连接，一边向 Agent 暴露标准 **MCP**（streamable HTTP / stdio）。

扩展侧源码与完整文档见 [jeffkit/browser-bridge](https://github.com/jeffkit/browser-bridge) · [文档站](https://jeffkit.github.io/browser-bridge/)

## 快速开始

```bash
# 生成 token
npx browser-bridge-gateway token

# 直连模式：扩展 WS + MCP streamable HTTP（远程 Agent 接入）
npx browser-bridge-gateway serve --token <你的token>

# 公网中转模式：双方都在 NAT 后 / 多浏览器集中管理（多 token + MCP 强制 Bearer）
npx browser-bridge-gateway relay --token <浏览器A的token> --token <agent用的token>

# 同机模式：由 Agent 以 stdio MCP 拉起
npx browser-bridge-gateway mcp --token <你的token>
```

`serve` 启动后：Agent 的 MCP 配置填 `http://<gateway 机器>:17833/mcp`；浏览器扩展（从 [GitHub Releases](https://github.com/jeffkit/browser-bridge/releases) 下载）options 里填 `ws://<gateway 机器>:17833` + token。

## 命令与常用参数

| 命令 | 场景 |
|------|------|
| `serve` | 常驻：扩展 WS + MCP streamable HTTP（`/mcp`、`/mcp/<浏览器ID>`） |
| `relay` | 公网中转：多 token 注册表 + MCP 强制 `Authorization: Bearer` |
| `mcp` | stdio：由同机 Agent 拉起（进程内含扩展 WS server） |
| `token` | 生成随机 token |

通用参数：`-p, --port`（默认 17833，0 为随机）、`--host`（默认 0.0.0.0）、`--token`（可多次）、`--allow-url <regex>`（URL 允许列表，可多次，缺省不限制）。

## MCP 工具面

14 个工具：`browser_status`、`browser_tab_list/open/close/select`、`browser_navigate`、`browser_snapshot`、`browser_click/fill/type/press/scroll`、`browser_evaluate`、`browser_screenshot`。推荐流：`browser_snapshot` → `@eN` 引用 → 交互。

## 安全

- token 鉴权：扩展 hello 握手校验，不匹配即断；relay 模式 MCP 每请求 Bearer，且已在线的浏览器槽位只认其配对 token。
- 传输加密由部署侧提供：公网部署务必前置 caddy/nginx（wss）或走 Tailscale。
- `--allow-url` 限制 Agent 可导航的站点。

## 环境变量

- `BROWSER_BRIDGE_TOKEN`：未提供 `--token` 时使用的默认 token（单值；多个 token 请重复 `--token`）。

## License

MIT
