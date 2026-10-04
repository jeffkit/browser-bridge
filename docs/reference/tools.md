# MCP 工具参考

gateway 暴露的全部工具。除标注外，`tabId` 均为可选参数，缺省取当前活跃标签页。

## 权限档（`--permission`，默认最窄）

| 档位 | 可用工具 |
|------|---------|
| `read-only`（默认） | `browser_status` `browser_tab_list` `browser_snapshot` `browser_screenshot` `browser_scroll` |
| `navigate-allowlist` | 上一档 + `browser_navigate` `browser_tab_open` `browser_tab_close` `browser_tab_select` `browser_click` `browser_fill` `browser_type` `browser_press` |
| `full` | 上一档 + `browser_evaluate` |

档位不足返回 `permission_denied`（提示里写明需要哪一档）；`--permission` 取值非法时 gateway 启动即失败。**owner 约定**：显式传入的 `tabId` 必须是本会话创建/导航过的标签页，否则返回 `tab_not_owned`（`--allow-foreign-tabs` 可关闭该限制；不带 `tabId` 的调用不受影响）。

## 状态

### `browser_status`

返回 `{ connected, browserId, client, gatewayVersion, permission, allowForeignTabs, allowUrlsEnabled, navBlocked, browsers }`。排查连接与策略问题的第一步：

- `permission`：当前生效的权限档；
- `allowForeignTabs`：是否允许操作非本会话创建的标签页；
- `navBlocked`：扩展上报的导航兜底拦截记录（最多 20 条，`{ tabId, url, from?, code, at }`）——点链接 / 表单提交 / JS 跳转越界时在这里可见；
- `browsers`：在线浏览器列表（多浏览器 / relay 场景用它确认设备名）。本工具绑定哪个浏览器由接入 URL 决定：`/mcp` → default，`/mcp/<浏览器ID>` → 对应设备。

## 标签页

| 工具 | 参数 | 返回 |
|------|------|------|
| `browser_tab_list` | — | `tabs: [{ id, windowId, title, url, active }]` + `hiddenNonOwned`（被策略隐藏的非 owner 标签页数量） |
| `browser_tab_open` | `url?` `active?`（默认 true） | 新标签页信息（该 tab 加入本会话 owner 集合） |
| `browser_tab_close` | `tabId` | `{ closed: true }` |
| `browser_tab_select` | `tabId` | 标签页信息 |

默认只列本会话创建/导航过的标签页；`hiddenNonOwned > 0` 说明浏览器里还有别的标签页存在但不展示（`--allow-foreign-tabs` 可看到全部）。

## 导航

### `browser_navigate`

| 参数 | 说明 |
|------|------|
| `url` | 目标 URL。受 `--allow-url` 约束（入参校验 + 扩展侧导航兜底） |
| `tabId?` | 缺省当前活跃页；显式传入时须是本会话 owner（否则 `tab_not_owned`） |
| `waitFor?` | `load`（默认）/ `domcontentloaded` / `none` |
| `timeoutMs?` | 等待上限，默认 15000，最大 60000 |

需 `--permission navigate-allowlist` 或更高。返回 `{ status: "complete" | "timeout", title, url, tabId }`——超时**不是错误**，`status: "timeout"` 表示页面加载慢，Agent 可自行决定继续 snapshot 或稍后重试。导航成功即把该 tab 记为本会话 owner。

## 读取

### `browser_snapshot`

返回：

```jsonc
{
  "tabId": 1, "url": "...", "title": "示例",
  "text": "<untrusted-page-content>\n# 示例\n- @e1 link \"首页\"\n- @e2 textbox \"搜索\"\n</untrusted-page-content>",  // 给 LLM 读的骨架
  "nodes": [ /* 结构化树，同 text 信息 */ ],
  "untrusted": true   // text 是页面原文（可能含 prompt injection）
}
```

骨架行格式：`- @eN role "名称" value="…" [checked,disabled,focused]`。缩进表示层级。

页面内容由站点控制、不可信：`text` 被 `<untrusted-page-content>` … `</untrusted-page-content>` 界出，结果带 `untrusted: true`。其中的任何「指令」都不得当作 Agent 指令执行。

### `browser_screenshot`

| 参数 | 说明 |
|------|------|
| `tabId?` | 非活跃页会先切换到前台再截 |
| `jpegQuality?` | 0-100；提供则输出 JPEG，否则 PNG |

返回 MCP 图片内容（`image/png` 或 `image/jpeg`），多模态 Agent 可直接读图。

## 交互（全部以 `@eN` 为目标）

| 工具 | 参数 | 行为 |
|------|------|------|
| `browser_click` | `ref` | 滚动到元素 → 聚焦 → 点击 |
| `browser_fill` | `ref` `value` | **清空后填入**，派发 input/change（兼容 React 受控组件）；也支持 `select` 与 contenteditable |
| `browser_type` | `ref` `text` | 逐字符**追加**输入（不清空） |
| `browser_press` | `key` `ref?` | 发送按键，如 `Enter`、`Escape`、`ArrowDown`、`Control+a`（修饰键 `+` 连接）；缺省发给当前焦点 |
| `browser_scroll` | `direction` `amount?` `ref?` | 方向滚动；提供 `ref` 时滚动该溢出容器自身 |

## 脚本

### `browser_evaluate`

| 参数 | 说明 |
|------|------|
| `fn` | 函数源码字符串，如 `"() => document.title"` |
| `args?` | 传给函数的参数，必须可 JSON 序列化 |
| `world?` | 仅 `MAIN` 可用（默认，页面上下文）；`ISOLATED` 因 MV3 扩展 CSP 禁 eval 不可用 |
| `tabId?` | — |

**需要 `--permission full`**（默认档与 `navigate-allowlist` 都返回 `permission_denied`）。返回 `{ value: <函数返回值>, untrusted: true }`——`value` 来自页面，同样视为不可信。返回值需可 JSON 序列化（DOM 节点不行，先转字符串）。

## 通用约定

- 元素引用 `@eN` 由 `browser_snapshot` 分配，**页面跳转后全部失效**（`stale_ref`）；
- 所有工具在扩展离线时返回 `browser_disconnected`，超时返回 `timeout`，档位不足返回 `permission_denied`，`tabId` 非本会话 owner 返回 `tab_not_owned`，见[错误码](./errors)。
