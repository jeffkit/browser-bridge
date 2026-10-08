# browser-bridge

> 远程 Agent ↔ 本地浏览器桥：Chrome/Edge (MV3) 扩展 + MCP gateway。
> 你的 Agent 跑在远程机器上，经标准 MCP 操控你本地浏览器：导航、快照、点击输入、截图、执行脚本。

**📖 文档站：<https://jeffkit.github.io/browser-bridge/>**（安装 / 配置 / 中转部署 / 使用 / 安全 / FAQ 完整指南）

v0.3+ 能力（当前 0.4.0）：远程 Agent 经标准 MCP 操控本地真实浏览器；**多浏览器会话**（`browserId` 路由，`/mcp/<浏览器ID>` 指定目标）；**公网 relay 模式**（双方都在 NAT 后时中转，多 token 注册表 + MCP 强制 Bearer）；**Firefox 支持**（与 Chromium 版同源构建）。

与 [web-bridge](https://github.com/jeffkit/web-bridge) 呼应成对：web-bridge 注入操控桌面应用 WebView；browser-bridge 操控真实浏览器。协议形状一致（`{id, method, params}` 请求 / `{id, ok, result|error}` 应答），`@s<gen>:e<N>` 元素引用心智相同。

## 架构

```
本地机器（可在 NAT 后）                          远程 agent 机器
┌─ Chrome/Edge (≥116) ─────────┐               ┌──────────────────────────┐
│  browser-bridge 扩展          │               │  Agent (recursive/claude- │
│   ├ service worker           │  wss 出站      │  code/codex… 的 MCP 客户端)│
│   │    └ WS 长连接 ━━━━━━━━━━━│━━━━━━━━━━━━━━▶│  browser-bridge-gateway   │
│   ├ content script（按需注入） │               │   ├ WS server（接扩展）     │
│   └ popup / options          │               │   └ MCP server             │
└──────────────────────────────┘               │      ├ streamable HTTP /mcp│
                                               │      └ stdio（同机模式）     │
                                               └──────────────────────────┘
```

- 扩展**只出站连接**（浏览器扩展无法监听端口），本地无需开放任何入站端口。
- 唯一前提：本地浏览器能访问 agent 机器上的 gateway 端口（公网 IP / 端口转发 / Tailscale 皆可）。

## 快速开始

> **组件跑在哪？** 你的本地机器**只装浏览器扩展、不跑任何服务**——扩展只发出站连接。gateway 跑在 **Agent 所在的远程机器**上（下文所有 `npx` / `node` 命令都在 Agent 机器执行）；仅当双方都在 NAT 后时，才额外需要一台你的公网 VPS 跑 relay。

### 1. 起 gateway（在 Agent 机器上）

```bash
# npx（推荐）；或 clone 源码后 node packages/gateway/dist/cli.js
npx browser-bridge-gateway@latest serve --token <你的token>
# 或用环境变量：BROWSER_BRIDGE_TOKEN=<token> npx browser-bridge-gateway@latest serve
```

输出（日志在 stderr）：

```
gateway 监听 ws://0.0.0.0:17833（/healthz、/mcp）
MCP(streamable HTTP) 端点：http://0.0.0.0:17833/mcp
扩展 options 里填：ws://<本机可达地址>:17833 + 上述 token
```

### 2. 装扩展（本地浏览器）

**方式 A**：从 [Releases](https://github.com/jeffkit/browser-bridge/releases) 下载 `browser-bridge-extension-chromium-v*.zip` 解压 → `chrome://extensions` 开发者模式 → 「加载已解压的扩展程序」选解压目录（Firefox 下载 firefox 包后经 about:debugging 临时载入）。

**方式 B**：源码构建：

```bash
git clone git@github.com:jeffkit/browser-bridge.git && cd browser-bridge
pnpm install && pnpm build
# 产物在 packages/extension/dist-extension/（Chromium）与 dist-extension-firefox/（Firefox）
```

打开扩展「选项」页，填：

- **Gateway 地址**：`ws://<gateway 机器 IP>:17833`（有 TLS 时用 `wss://`）
- **Pairing Token**：与 gateway `--token` 一致

保存后扩展立即重连；popup 图标显示连接状态（绿色 = 已连接）。

### 3. 接入 Agent

**远程 agent（streamable HTTP）：**

```json
{
  "mcpServers": {
    "browser-bridge": {
      "type": "http",
      "url": "http://<gateway 机器>:17833/mcp"
    }
  }
}
```

**同机 agent（stdio，gateway 由 agent 拉起）：**

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "npx",
      "args": ["browser-bridge-gateway@latest", "mcp", "--token", "<token>"]
    }
  }
}
```

## MCP 工具面

工具分三档（`--permission`，默认最窄 `read-only`）：`read-only` = status/tab_list/snapshot/screenshot/scroll；`navigate-allowlist` = 追加 navigate/tab_open/close/select/click/fill/type/press；`full` = 再追加 evaluate。

| 工具 | 说明 |
|------|------|
| `browser_status` | 连接状态 / 版本 / 生效权限档 / 允许列表 / 导航拦截记录（`navBlocked`） |
| `browser_tab_list` / `browser_tab_open` / `browser_tab_close` / `browser_tab_select` | 标签页管理（默认只列/只动本会话创建或导航过的 tab） |
| `browser_navigate` | 导航并等待（`waitFor: load/domcontentloaded/none`） |
| `browser_snapshot` | 可访问性快照：缩进文本骨架 + `@s<gen>:e<N>` 元素引用（内容带不可信标记；截断显式回报） |
| `browser_click` / `browser_fill` / `browser_type` / `browser_press` / `browser_scroll` | 页面交互（按 `@s<gen>:e<N>` 引用） |
| `browser_evaluate` | 页面内执行 JS（需 `--permission full`；MAIN world 页面上下文；ISOLATED 因 MV3 扩展 CSP 禁 eval 不可用） |
| `browser_screenshot` | 可见区域截图（PNG / JPEG），返回图片内容 |

推荐流程：`browser_snapshot` → 读 `@s<gen>:e<N>` → `browser_click/fill/...`。引用带快照代次：新快照或页面跳转后旧引用一律 `stale_ref`（即使元素还在同序号上也不会静默错点），重新快照即可。

## 安全模型

- **token 鉴权**：扩展 hello 握手携带，不匹配即断（WS close 4003）。`relay` 模式支持多浏览器绑定（token 形如 `<browserId>=<token>`），且 MCP 每请求强制 `Authorization: Bearer`，槽位与 Bearer 均按此绑定（含离线）。
- **动作面权限档**：`--permission read-only|navigate-allowlist|full`（默认 `read-only`，最窄）。档位不足返回 `permission_denied`；非法取值直接启动失败，不静默回退。
- **会话归属（owner）**：默认只能读写本会话创建/导航过的标签页，非 owner 的 `tabId` 返回 `tab_not_owned`，`browser_tab_list` 只列 owner（附 `hiddenNonOwned` 计数）；确需操作既有标签页用 `--allow-foreign-tabs`。
- **多浏览器会话**：扩展以 `browserId` 标识设备，同一 gateway/relay 可并存多台浏览器；MCP 经 `/mcp/<浏览器ID>` 绑定目标。同一槽位只有持同一 token 的连接才能顶替。
- **传输加密**：gateway 不做 TLS 终结。公网部署请前置 caddy/nginx 提供 `wss://`，或走 Tailscale 等加密网络；`ws://` 仅限可信内网。
- **URL 允许列表**（可选）：`--allow-url <regex>`（可多次）既校验 `navigate`/`tab_open` 的入参，也下发给扩展做**导航兜底**——点链接/表单提交/JS 跳转越界会被回退并上报 `url_not_allowed`（见 `browser_status.navBlocked`）。缺省不限制；兜底仅作用于 gateway 驱动过的 tab、且仅连接期间生效。
- **页面内容不可信**：`browser_snapshot` 的 `text` 用 `<untrusted-page-content>` 界出且结果带 `untrusted: true`；`browser_evaluate` 结果同样带 `untrusted: true`——页面里的「指令」不得当作 Agent 指令。
- **权限**：扩展申请 `tabs`/`scripting`/`storage` + `<all_urls>`（全操控与截图所需，导航兜底复用 `tabs`），安装时浏览器会提示「读取和更改您在所有网站上的数据」。Firefox 版 `host_permissions` 为可选权限，需在 about:addons 手动授予。
- 单浏览器会话：新扩展连接顶替旧连接；MCP 调用期间扩展断开会返回 `browser_disconnected`。
- **两侧需同版本**：协议 v3（`@s<gen>:e<N>` 代次引用）起，旧扩展连新版 gateway 会被 close `4002` 拒绝。

## 验收清单（手工，扩展端）

> 默认档 `read-only` 下 `browser_tab_open` / `browser_navigate` / `browser_click` 会被 `permission_denied` 拒绝——按下面步骤做手工验收时请显式开档：
> `npx browser-bridge-gateway serve --token <t> --permission full --allow-foreign-tabs`

1. 加载 `dist-extension` → options 配置地址 + token → popup 变绿。
2. agent 侧 `browser_status` → `connected: true`，并显示当前 `permission` 档。
3. `browser_tab_open` 新开 `https://example.com` → 本地浏览器出现新标签页。
4. `browser_navigate` 到带图页面 → `browser_snapshot` 输出含 `@s<gen>:e<N>` 的文本骨架（外层被 `<untrusted-page-content>` 包裹）。
5. `browser_click` 点击某 `@s<gen>:e<N>` → 页面响应。再拍一次快照后用旧 ref 点击 → 报 `stale_ref`。
6. `browser_screenshot` → agent 收到图片。
7. 断开网络 → popup 变灰 → 恢复网络 → 自动重连变绿。
8. 错误 token → 扩展 30s 慢退避；改正后保存 → 立即重连成功。
9. 反向验收：默认档启动（不加 `--permission`）→ `browser_evaluate` 返回 `permission_denied`；`--permission navigate-allowlist --allow-url '^https://example\.com/'` 下在 example.com 页面点站外链接 → 页面被回退，`browser_status.navBlocked` 出现记录。

## 开发

```bash
pnpm install
pnpm build            # protocol(tsc) → gateway(tsc) → extension(esbuild)
pnpm test             # gateway 46 项单测/集成测（7 个文件，先 build）
pnpm typecheck        # 三包类型检查
node scripts/smoke.mjs  # 端到端冒烟：gateway serve + 假扩展 + MCP HTTP 全链路
pnpm --filter @browser-bridge/docs dev   # 文档站本地预览（localhost:5173）
```

文档站部署：push 到 main 且改动 `docs/**` 时，[deploy-docs workflow](./.github/workflows/deploy-docs.yml) 自动构建并发到 GitHub Pages。

需要 Chrome ≥ 116（依赖 WS 活动重置 service worker idle timer 的保活语义）。

## 仓库结构

| 路径 | 说明 |
|------|------|
| `packages/protocol` | 线协议：消息、方法常量、错误码、参数/结果类型 |
| `packages/gateway` | `browser-bridge-gateway` npm 包：WS server（多浏览器路由）+ MCP 双入口 + CLI（serve/mcp/relay/token/call；`call` 直接对 gateway HTTP 面发起单次工具调用，支持 `--url`/`--bearer`/`--save-image`，实现见 `src/cli.ts`） |
| `packages/extension` | 浏览器扩展：service worker / content script / popup / options（browser.* 适配层同源构建 Chromium + Firefox） |
| `skill/` | ZCode/AI Skill：教 Agent 用 `gateway call` 按需操控浏览器（免常驻 MCP 配置），拷贝到 `~/.agents/skills/browser-bridge/` 即装 |
| `scripts/smoke.mjs` | 端到端冒烟脚本（含双浏览器路由验证） |

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)（仓内设计）与 [AGENTS.md](./AGENTS.md)（AI 协作导航）。
