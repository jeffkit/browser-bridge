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

通用参数：`-p, --port`（默认 17833，0 为随机）、`--host`（默认 0.0.0.0）、`--token`（可多次）、`--permission <tier>`（动作面权限档 `read-only`｜`navigate-allowlist`｜`full`，**默认 `read-only` 最窄**）、`--allow-foreign-tabs`（允许操作/列出非本会话创建的既有标签页，默认关闭）、`--allow-url <regex>`（URL 允许列表，可多次，缺省不限制；既校验入参也下发给扩展做导航兜底）。

## MCP 工具面

14 个工具：`browser_status`、`browser_tab_list/open/close/select`、`browser_navigate`、`browser_snapshot`、`browser_click/fill/type/press/scroll`、`browser_evaluate`、`browser_screenshot`。推荐流：`browser_snapshot` → `@eN` 引用 → 交互。

## 安全

- token 鉴权：扩展 hello 握手校验，不匹配即断；relay 模式 MCP 每请求 Bearer，且已在线的浏览器槽位只认其配对 token。
- 传输加密由部署侧提供：公网部署务必前置 caddy/nginx（wss）或走 Tailscale。
- 动作面默认最窄：`--permission` 缺省 `read-only`（只看不动），需要交互加 `navigate-allowlist`，需要页面内执行 JS 才用 `full`；档位不足返回 `permission_denied`。
- `--allow-url` 既校验 `navigate`/`tab_open` 入参，也下发给扩展在导航实际发生处兜底（点链接/表单/JS 跳转越界会被回退并上报 `url_not_allowed`，记录在 `browser_status.navBlocked`）。
- 会话归属：默认只能读写本会话创建/导航过的标签页（`tab_not_owned`）；`--allow-foreign-tabs` 可放开。
- 页面内容标记为不可信：`browser_snapshot` 的 `text` 用 `<untrusted-page-content>` 界出，snapshot/evaluate 结果带 `untrusted: true`。

## 环境变量

- `BROWSER_BRIDGE_TOKEN`：未提供 `--token` 时使用的默认 token（单值；多个 token 请重复 `--token`）。

## License

MIT
