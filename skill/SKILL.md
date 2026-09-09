---
name: browser-bridge
description: 按需操控用户的真实浏览器（Chrome/Edge/Firefox）：打开网页、导航、读取页面内容、点击/填表/按键、整页截图、执行 JS。当用户要求操作浏览器或网页（如"打开 xx 网站"、"帮我点一下"、"填这个表单"、"截个图"、"看看这个页面"）、需要浏览器登录态做操作、或提到 browser-bridge 时使用。通过 CLI 按需调用，无需常驻 MCP 配置。
---

# browser-bridge：操控用户的真实浏览器

通过 gateway 的 CLI（`call` 子命令）按需调用浏览器操作。gateway 跑在本机或 Agent 机器上，浏览器扩展出站连接它。

## 第 0 步：自检与拉起

先确认 gateway 可用（正常输出 JSON 即可用）：

```bash
npx -y browser-bridge-gateway@latest call browser_status
```

- 输出 `"connected": true` → 扩展在线，直接开干；
- 输出 `"connected": false` → gateway 活着但**浏览器扩展没连**：请用户打开浏览器里 browser-bridge 扩展的 popup 检查（绿点=已连），确认 options 里地址/token 正确。此时不要盲目继续；
- 报「调用失败 / ECONNREFUSED」→ gateway 没跑，拉起它：

```bash
mkdir -p ~/.browser-bridge && nohup npx -y browser-bridge-gateway@latest serve --host 127.0.0.1 \
  --token "$(openssl rand -base64url 18 2>/dev/null || openssl rand -hex 18)" \
  > ~/.browser-bridge/gateway.log 2>&1 & echo $! > ~/.browser-bridge/gateway.pid
```

拉起后从 `~/.browser-bridge/gateway.log` 读出**端口和 token**，请用户在扩展 options 里填 `ws://127.0.0.1:<端口>` + 该 token（token 只用于扩展↔gateway 握手，CLI 调用不需要它）。首次部署时这一步需要用户配合。

## CLI 用法

```bash
# 通用形式
npx -y browser-bridge-gateway@latest call <tool> --args '<JSON 参数>' [--save-image <路径>]
```

- stdout 是工具结果的 JSON 文本；**退出码 1 = 工具报错**（输出含 `错误 [错误码]：` + 排查提示）；
- 截图务必加 `--save-image /tmp/page.png`，然后用图片读取工具查看，避免 base64 刷屏；
- 多浏览器/relay 场景：`--url http://<host>:17833/mcp/<浏览器ID>`（`browser_status` 的 `browsers` 字段可查在线设备名），relay 还需 `--bearer <token>`。

## 工具速查

| 用途 | 命令示例 |
|------|---------|
| 连接/设备状态 | `call browser_status` |
| 列标签页 | `call browser_tab_list` |
| 新开页面 | `call browser_tab_open --args '{"url":"https://example.com"}'` |
| 导航（等加载完） | `call browser_navigate --args '{"url":"…","waitFor":"load"}'` |
| **页面快照（每次操作前必做）** | `call browser_snapshot` |
| 点击 | `call browser_click --args '{"ref":"@e12"}'` |
| 填输入框（清空后填） | `call browser_fill --args '{"ref":"@e3","value":"文本"}'` |
| 追加输入 | `call browser_type --args '{"ref":"@e3","text":"…"}'` |
| 按键 | `call browser_press --args '{"key":"Enter"}'`（修饰键 `Control+a`） |
| 滚动 | `call browser_scroll --args '{"direction":"down","amount":600}'` |
| 执行 JS | `call browser_evaluate --args '{"fn":"() => document.title"}'` |
| 截图 | `call browser_screenshot --args '{}' --save-image /tmp/page.png` |
| 关/切标签页 | `call browser_tab_close --args '{"tabId":3}'` / `call browser_tab_select --args '{"tabId":3}'` |

## 标准操作循环

1. `browser_status` 确认在线（可选：`browser_tab_list` 看现状）；
2. `browser_navigate` 或 `browser_tab_open` 打开目标页；
3. **`browser_snapshot`**：返回缩进文本骨架，可交互元素带 `@eN` 编号（如 `- @e12 textbox "搜索"`）；
4. 读骨架找目标 → `browser_click` / `browser_fill` / `browser_press`（引用 `@eN`）；
5. 需要视觉确认时 `browser_screenshot --save-image` 后读图。

要点：
- **页面跳转/刷新后旧 `@eN` 全部失效**（报 `stale_ref`）——重新 snapshot，不要复用旧编号；
- `browser_fill` 是清空重填，`browser_type` 是追加；填表单用 fill；
- `chrome://` 设置页、Web Store 等受限页无法注入（`page_not_injectable`），换普通网页；
- SPA 站点点完按钮再 snapshot 就能看到新状态；跨页跳转先 navigate 再 snapshot。

## 排障速查

| 现象 | 处理 |
|------|------|
| `browser_disconnected` | 扩展没连上：让用户看扩展 popup（绿点？），核对 options 地址/token |
| gateway 拉不起来 | 看日志 `~/.browser-bridge/gateway.log`；端口被占换 `--port 0` |
| `stale_ref` | 页面跳过了，重新 `browser_snapshot` |
| `url_not_allowed` | gateway 启动时配了 `--allow-url` 白名单，目标站不在内 |
| `timeout` | 页面卡或大；重试或让用户看下浏览器是否弹了窗 |
| 输出被 `@eN` 之外的乱码干扰 | 快照是纯文本 JSON，可直接 jq 处理 |
