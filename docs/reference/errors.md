# 错误码

所有错误经 MCP 工具结果返回，格式：

```text
错误 [code]：人类可读信息
提示：针对该错误的排查建议（已知错误码才有）
```

| 错误码 | 含义 | 常见原因与处理 |
|--------|------|----------------|
| `auth_failed` | 扩展握手鉴权失败 | 扩展 options 的 token 与 gateway `--token` 不一致；改对后保存即重连 |
| `browser_disconnected` | gateway 收到请求时扩展不在线 | 浏览器没开 / 扩展被禁用 / 地址填错 / 网络断了；先 `browser_status` 排查 |
| `timeout` | 扩展响应超时 | 页面卡死或浏览器忙碌；重试或加大 `timeoutMs` |
| `method_not_found` | 未知方法 | 扩展与 gateway 版本不匹配，两侧都更新 |
| `bad_params` | 参数缺失或非法 | 检查必填参数（如 `browser_click` 的 `ref`） |
| `tab_not_found` | 目标标签页不存在 | 先 `browser_tab_list` 拿有效 `tabId` |
| `screenshot_failed` | 截图失败 | 没有可截图的可见窗口，或窗口最小化；恢复窗口后重试 |
| `navigation_timeout` | 导航未在窗口内完成 | 页面太慢；`browser_navigate` 的 `waitFor` 改 `none` 或加大 `timeoutMs` |
| `page_not_injectable` | 页面不允许注入脚本 | `chrome://` 设置页、Chrome 商店、PDF 查看器等受限页面；换普通网页 |
| `page_action_failed` | 页面内操作失败 | 元素被遮挡 / 已消失 / 不可输入；重新 snapshot |
| `stale_ref` | `@eN` 引用已失效 | 页面跳转或刷新清空了引用缓存；重新 `browser_snapshot` |
| `url_not_allowed` | 目标 URL 不在允许列表 | gateway `--allow-url` 拦截；调整允许列表或换允许内的 URL |
| `internal` | 兜底错误 | 看 gateway stderr 日志 |

## WS close code（扩展 popup / gateway 日志里出现）

| code | 含义 |
|------|------|
| 4001 | 首条消息不是 hello / 握手超时 |
| 4002 | 线协议版本不匹配（两侧版本差太多） |
| 4003 | token 错误 |
| 1000 | 正常关闭（被新连接顶替 / gateway 停止 / 重新配置） |
