# 配置

按顺序完成三件事：**起 gateway → 配扩展 → 接 Agent**。

## 1. 启动 gateway（Agent 机器）

```bash
npx browser-bridge-gateway@latest serve --token s3cr3t-token
```

常用命令：

| 命令 | 场景 |
|------|------|
| `serve` | 常驻：扩展 WS + MCP streamable HTTP（本页余下内容） |
| `relay` | 公网中转：双 NAT / 多浏览器集中管理，见 [Relay](./relay) |
| `mcp` | 由同机 Agent 以 stdio 拉起 |
| `token` | 生成随机 token |

`serve` 常用参数：

| 参数 | 默认 | 说明 |
|------|------|------|
| `-p, --port <n>` | `17833` | 监听端口，`0` 为随机 |
| `--host <h>` | `0.0.0.0` | 监听地址 |
| `--token <t>` | 环境变量 `BROWSER_BRIDGE_TOKEN`，都没有则随机生成并打印 | 扩展握手 token；**可重复提供**（relay 注册表） |
| `--permission <tier>` | `read-only`（最窄档） | 动作面权限档：`read-only` / `navigate-allowlist` / `full`（详见[安全](/guide/security)）。取值非法直接启动失败，不静默回退 |
| `--allow-foreign-tabs` | 关闭 | 允许操作/列出非本会话创建的既有标签页；缺省只允许本会话 navigate/create 过的 tab |
| `--allow-url <regex>` | 不限制 | URL 允许列表正则，**可多次提供**。既校验 `navigate`/`tab_open` 入参，也下发给扩展做导航兜底（点链接/表单/JS 跳转越界会被回退并上报） |

示例：只允许操作公司内网与 GitHub，且需要填表/点击：

```bash
npx browser-bridge-gateway@latest serve --token s3cr3t-token \
  --permission navigate-allowlist \
  --allow-url '^https://(github\.com|git\.corp\.example\.cn)/'
```

需要 `browser_evaluate`（页面内执行 JS）时才开 `--permission full`；不确定就先用默认档，按 `permission_denied` 提示逐步放开。启动日志（stderr）会打印生效档位与既有标签页策略。

保持进程常驻（systemd / pm2 / `nohup` 均可）。生产建议前置反向代理提供 TLS：

```nginx
# caddy 示例：一行即得 wss
bridge.example.com {
  reverse_proxy 127.0.0.1:17833
}
```

## 2. 配置扩展（本地浏览器）

点浏览器工具栏的 browser-bridge 图标 → **打开设置**，填三项：

| 字段 | 值 |
|------|-----|
| **Gateway 地址** | `ws://<Agent 机器 IP>:17833`；经反代 / Tailscale 加密时用 `wss://bridge.example.com` |
| **Pairing Token** | 与 gateway `--token` 完全一致 |
| **浏览器 ID** | 留空（单浏览器）；连多台时填唯一设备名如 `laptop`，Agent 经 `/mcp/<浏览器ID>` 指定目标（见 [Relay](./relay)） |

保存后扩展立即重连。点开 popup：**绿点 = 已连接**；黄点 = 连接中；红点 = 出错（下方会显示原因）。

## 3. 接入 Agent

### 远程 Agent（streamable HTTP，最常用）

在 Agent 的 MCP 配置中加：

```json
{
  "mcpServers": {
    "browser-bridge": {
      "type": "http",
      "url": "http://<Agent 机器 IP>:17833/mcp"
    }
  }
}
```

Agent 与 gateway 在同一台机器时 `url` 用 `http://127.0.0.1:17833/mcp`。

### 同机 Agent（stdio）

gateway 也可以由 Agent 直接拉起（单进程内含扩展 WS server + stdio MCP）：

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "npx",
      "args": [
        "browser-bridge-gateway@latest",
        "mcp", "--port", "17833", "--token", "s3cr3t-token"
      ]
    }
  }
}
```

两种模式选其一即可；工具面完全相同。

## 4. 连通性检查

Agent 里依次执行：

默认档 `read-only` 只看不动，第 3 条需要 gateway 以 `--permission navigate-allowlist`（或更高）启动；默认档下它返回 `permission_denied` 属正常行为。

1. `browser_status` → 期望 `"connected": true`，并显示扩展名称与版本、当前 `permission` 档；
2. `browser_tab_list` → 列出本会话创建/导航过的标签页（`hiddenNonOwned` = 被策略隐藏的其他标签页数量）；
3. `browser_tab_open` 新开 `https://example.com` → 本地浏览器出现新标签页。

三条都通，安装完成。如果卡住，看 [FAQ / 故障排查](/reference/faq)。

## 网络方案速查

| 场景 | gateway 地址填法 |
|------|------------------|
| Agent 机有公网 IP | `ws://<公网IP>:17833`（建议前置反代上 `wss://`） |
| 同一内网 / VPN | `ws://<内网IP>:17833` |
| Tailscale | `ws://<tailscale-host>:17833`（流量已加密，无需反代） |
| 双方都在 NAT 后 | 用 Tailscale 等组网；或自建公网 relay（协议已预留，暂未内置） |
