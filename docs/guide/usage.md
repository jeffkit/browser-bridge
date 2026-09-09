# 使用

## 工具面总览

gateway 向 Agent 暴露 14 个 MCP 工具，完整参数见 [MCP 工具参考](/reference/tools)：

| 分组 | 工具 |
|------|------|
| 状态 | `browser_status` |
| 标签页 | `browser_tab_list` `browser_tab_open` `browser_tab_close` `browser_tab_select` |
| 导航 | `browser_navigate` |
| 读取 | `browser_snapshot` `browser_screenshot` |
| 交互 | `browser_click` `browser_fill` `browser_type` `browser_press` `browser_scroll` |
| 脚本 | `browser_evaluate` |

## 核心循环：snapshot → @eN → act

操作页面的推荐方式，三步：

```text
① browser_snapshot
   → 返回页面骨架，可交互元素带编号：
     - @e12 textbox "搜索"
     - @e13 button "搜索"

② 读骨架，找到目标元素的 @eN

③ browser_click { "ref": "@e13" }
   browser_fill  { "ref": "@e12", "value": "browser-bridge" }
```

要点：

- **页面跳转 / 刷新后旧 `@eN` 全部失效**，相关操作会返回 `stale_ref` 错误——重新 snapshot 即可，不要复用旧编号；
- `browser_fill` 是「清空后填入」，`browser_type` 是「追加输入」，清空重填一律用 fill；
- 按键用 `browser_press`，如 `Enter`、`Escape`、`Control+a`（修饰键用 `+` 连接）。

## 一个完整回合的示例

Agent 完成登录（示意）：

```text
Agent: browser_navigate { "url": "https://example.com/login" }
       → { "status": "complete", "title": "登录" }
Agent: browser_snapshot
       → - @e3 textbox "用户名"
         - @e4 textbox "密码"  [type=password]
         - @e5 button "登录"
Agent: browser_fill { "ref": "@e3", "value": "alice" }
Agent: browser_fill { "ref": "@e4", "value": "••••••" }
Agent: browser_click { "ref": "@e5" }
Agent: browser_screenshot
       → （返回图片，确认登录成功）
```

## 读取类工具的选择

- **`browser_snapshot`（默认首选）**：返回结构化文本骨架，token 便宜，交互必需；
- **`browser_screenshot`**：给多模态 Agent 看视觉细节（布局、验证码、图表），返回 PNG/JPEG 图片内容；非活跃标签页会先自动切换到前台再截；
- **`browser_evaluate`**：抽取骨架表达不了的精确数据，如 `() => JSON.parse(document.querySelector('#__NEXT_DATA__').textContent)`。默认在隔离世界执行，`world: "MAIN"` 可访问页面自己的 `window`。

## 扩展端状态

| popup 图标 | 含义 | 处理 |
|-----------|------|------|
| 🟢 已连接 | 一切正常 | — |
| 🟡 连接中 | 正在握手/重连 | 稍等；持续黄点看 FAQ |
| ⚪ 未连接 | 未配置或已停止 | 打开设置检查地址与 token |
| 🔴 出错 | 地址不可达 / token 错 | 按 popup 提示排查，常见问题见 FAQ |

网络闪断不用管——扩展会自动指数退避重连，恢复后自动上线，gateway 侧 Agent 调用会短暂收到 `browser_disconnected`。
