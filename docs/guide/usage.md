# 使用

## 工具面总览

gateway 向 Agent 暴露 14 个 MCP 工具，完整参数见 [MCP 工具参考](/reference/tools)：

| 分组 | 工具 | 最低档位 |
|------|------|---------|
| 状态 | `browser_status` | `read-only` |
| 标签页 | `browser_tab_list` | `read-only` |
| 标签页 | `browser_tab_open` `browser_tab_close` `browser_tab_select` | `navigate-allowlist` |
| 导航 | `browser_navigate` | `navigate-allowlist` |
| 读取 | `browser_snapshot` `browser_screenshot` | `read-only` |
| 交互 | `browser_click` `browser_fill` `browser_type` `browser_press` | `navigate-allowlist` |
| 交互 | `browser_scroll` | `read-only` |
| 脚本 | `browser_evaluate` | `full` |

档位由 gateway 启动参数 `--permission` 决定，**默认 `read-only`（最窄）**；档位不足返回 `permission_denied`。除状态类工具外，显式传入的 `tabId` 必须是本会话创建或导航过的标签页（否则 `tab_not_owned`）。

## 核心循环：snapshot → `@s<gen>:e<N>` → act

操作页面的推荐方式，三步：

```text
① browser_snapshot
   → 返回页面骨架（带 gen 代次），可交互元素带编号：
     - @s3:e12 textbox "搜索"
     - @s3:e13 button "搜索"

② 读骨架，找到目标元素的 @s3:eN

③ browser_click { "ref": "@s3:e13" }
   browser_fill  { "ref": "@s3:e12", "value": "browser-bridge" }
```

要点：

- **引用绑定快照代次（`@s<gen>:e<N>`，写作 `@s3:e12`）**：再次 snapshot（gen+1）或页面跳转/刷新后，旧引用一律返回 `stale_ref`——即使元素还在同序号上也不会静默错点。重新 snapshot，用最新一次返回的引用；
- 快照返回 `truncated: true` 时说明页面超出规模上限（800 节点/20 层），部分交互元素可能缺失——缩小范围（先滚动/导航到目标区块）后重拍；
- `browser_fill` 是「清空后填入」，`browser_type` 是「追加输入」，清空重填一律用 fill；
- 按键用 `browser_press`，如 `Enter`、`Escape`、`Control+a`（修饰键用 `+` 连接）。

## 一个完整回合的示例

Agent 完成登录（示意）：

```text
Agent: browser_navigate { "url": "https://example.com/login" }
       → { "status": "complete", "title": "登录" }
Agent: browser_snapshot
       → - @s1:e3 textbox "用户名"
         - @s1:e4 textbox "密码"  [type=password]
         - @s1:e5 button "登录"
Agent: browser_fill { "ref": "@s1:e3", "value": "alice" }
Agent: browser_fill { "ref": "@s1:e4", "value": "••••••" }
Agent: browser_click { "ref": "@s1:e5" }
Agent: browser_screenshot
       → （返回图片，确认登录成功）
```

> 这一回合用到 navigate / fill / click / screenshot，需要 gateway 以 `--permission navigate-allowlist`（或 `full`）启动。

## 读取类工具的选择

- **`browser_snapshot`（默认首选）**：返回结构化文本骨架，token 便宜，交互必需；
- **`browser_screenshot`**：给多模态 Agent 看视觉细节（布局、验证码、图表），返回 PNG/JPEG 图片内容；非活跃标签页会先自动切换到前台再截；
- **`browser_evaluate`**：抽取骨架表达不了的精确数据，如 `() => JSON.parse(document.querySelector('#__NEXT_DATA__').textContent)`。**需 gateway 以 `--permission full` 启动**（否则返回 `permission_denied`）。在页面上下文（MAIN world）执行，受页面 CSP 约束；`world: "ISOLATED"` 因 MV3 扩展 CSP 禁 eval 不可用，调用会得到明确报错。返回结果带 `untrusted: true`——页面内容不可信。

## 扩展端状态

| popup 图标 | 含义 | 处理 |
|-----------|------|------|
| 🟢 已连接 | 一切正常 | — |
| 🟡 连接中 | 正在握手/重连 | 稍等；持续黄点看 FAQ |
| ⚪ 未连接 | 未配置或已停止 | 打开设置检查地址与 token |
| 🔴 出错 | 地址不可达 / token 错 | 按 popup 提示排查，常见问题见 FAQ |

网络闪断不用管——扩展会自动指数退避重连，恢复后自动上线，gateway 侧 Agent 调用会短暂收到 `browser_disconnected`。
