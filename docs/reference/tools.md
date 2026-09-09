# MCP 工具参考

gateway 暴露的全部工具。除标注外，`tabId` 均为可选参数，缺省取当前活跃标签页。

## 状态

### `browser_status`

返回 `{ connected, client, gatewayVersion, allowUrlsEnabled }`。排查连接问题的第一步。

## 标签页

| 工具 | 参数 | 返回 |
|------|------|------|
| `browser_tab_list` | — | `tabs: [{ id, windowId, title, url, active }]` |
| `browser_tab_open` | `url?` `active?`（默认 true） | 新标签页信息 |
| `browser_tab_close` | `tabId` | `{ closed: true }` |
| `browser_tab_select` | `tabId` | 标签页信息 |

## 导航

### `browser_navigate`

| 参数 | 说明 |
|------|------|
| `url` | 目标 URL（受 `--allow-url` 约束） |
| `tabId?` | 缺省当前活跃页 |
| `waitFor?` | `load`（默认）/ `domcontentloaded` / `none` |
| `timeoutMs?` | 等待上限，默认 15000，最大 60000 |

返回 `{ status: "complete" | "timeout", title, url, tabId }`——超时**不是错误**，`status: "timeout"` 表示页面加载慢，Agent 可自行决定继续 snapshot 或稍后重试。

## 读取

### `browser_snapshot`

返回：

```jsonc
{
  "tabId": 1, "url": "...", "title": "示例",
  "text": "# 示例\n- @e1 link \"首页\"\n- @e2 textbox \"搜索\"",  // 给 LLM 读的骨架
  "nodes": [ /* 结构化树，同 text 信息 */ ]
}
```

骨架行格式：`- @eN role "名称" value="…" [checked,disabled,focused]`。缩进表示层级。

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
| `world?` | `ISOLATED`（默认，隔离世界）/ `MAIN`（页面自己的 window） |
| `tabId?` | — |

返回 `{ value: <函数返回值> }`。返回值需可 JSON 序列化（DOM 节点不行，先转字符串）。

## 通用约定

- 元素引用 `@eN` 由 `browser_snapshot` 分配，**页面跳转后全部失效**（`stale_ref`）；
- 所有工具在扩展离线时返回 `browser_disconnected`，超时返回 `timeout`，见[错误码](./errors)。
