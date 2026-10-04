# 安全

browser-bridge 让 Agent 能操控你的浏览器（读页面、点按钮、执行脚本、截图）。**能力由 `--permission` 档位决定，缺省是最窄的 `read-only`（只看不动）**——但放开档位后即是全操控，使用前请理解下面的模型。

## 鉴权

- 扩展与 gateway 之间用 **pairing token** 鉴权：扩展每次连接的第一条 hello 消息携带 token，不匹配立即断开（WS close code 4003），并且进入 30 秒慢退避。
- token 存在两处：扩展的本地存储（`chrome.storage.local`）与 gateway 进程参数。**不要把 token 提交进代码仓库或贴在公开渠道**。
- gateway 未显式提供 token 时会随机生成一个并打印在日志里——重启即换，适合试跑，不适合长期使用。

## 传输加密

gateway 自身**不做 TLS 终结**，传输安全由部署方式决定：

| 方案 | 加密 | 适用 |
|------|------|------|
| `ws://` 直连 | ❌ 明文 | 仅限可信内网 / 本机 |
| Tailscale / WireGuard | ✅ 隧道加密 | 推荐，零配置 |
| caddy / nginx 反代 + `wss://` | ✅ TLS | 公网部署必须 |

公网明文 `ws://` 等于把浏览器操控权暴露给整条链路上的窃听者，请勿使用。

## 最小权限：--permission（默认最窄）

gateway 的动作面分三档，**缺省是最窄的 `read-only`**，需要什么开什么：

| 档位 | 允许的工具 | 说明 |
|------|-----------|------|
| `read-only`（默认） | `browser_status` `browser_tab_list` `browser_snapshot` `browser_screenshot` `browser_scroll` | 只看不动：导航/点击/填表/按键/执行 JS 一律返回 `permission_denied` |
| `navigate-allowlist` | 上一档 + `browser_navigate` `browser_tab_open` `browser_tab_close` `browser_tab_select` `browser_click` `browser_fill` `browser_type` `browser_press` | 可操作页面，导航受允许列表约束（含扩展侧兜底）；仍不能执行任意 JS |
| `full` | 全部（含 `browser_evaluate`） | 页面内执行任意 JS（读 cookie/localStorage、带凭据同源 fetch）；只在完全信任 Agent 时使用 |

```bash
# 只读巡检
node packages/gateway/dist/cli.js serve --token <t>

# 需要填表/点击（导航限于允许列表）
node packages/gateway/dist/cli.js serve --token <t> \
  --permission navigate-allowlist \
  --allow-url '^https://(github\.com)/'

# 需要页面内执行 JS（最危险）
node packages/gateway/dist/cli.js serve --token <t> --permission full
```

档位在 gateway 的工具层强制生效，扩展侧不参与判定；`--permission` 取值非法时 gateway 直接退出（不静默回退）。档位不足时报 `permission_denied`，提示会写明所需档位。`browser_status` 的 `permission` 字段可随时确认当前档位。

## 会话归属：默认只碰自己开的标签页

gateway 记录**本次会话（连接生命周期）里创建或导航过的 tabId**（owner），默认：

- 显式传入非 owner 的 `tabId` → 拒绝（`tab_not_owned`）；
- `browser_tab_list` 只列 owner 标签页，另有 `hiddenNonOwned` 计数告诉你「还有别的标签页被策略隐藏」；
- 不带 `tabId` 的调用（缺省 = 当前活跃页）仍按协议既有约定落到活跃 tab——所以「先 navigate 一次，该 tab 就归本会话」是最小可用路径。

确需操作既有的标签页（比如你已登录的站点），用 `--allow-foreign-tabs` 显式开启；或反过来先 `browser_navigate` 到目标站点，让该 tab 成为 owner。

## 导航允许列表：--allow-url（参数校验 + 扩展侧兜底）

`--allow-url` 是正则允许列表（可多次），语义有两层：

1. **参数入口校验**：`browser_navigate` / `browser_tab_open` 的目标 URL 不在列表内直接返回 `url_not_allowed`；
2. **导航兜底**：gateway 在扩展握手后把允许列表下发给扩展，扩展在 `tabs.onUpdated` 上监测**实际发生的导航**，越界即回退到该 tab 上一个允许的 URL（没有则 `about:blank`），并把 `url_not_allowed` 上报 gateway（记录在 `browser_status` 的 `navBlocked`）。因此**点链接、表单提交、页面 JS 跳转**同样被拦，不只是工具参数。

```bash
node packages/gateway/dist/cli.js serve --token <t> \
  --allow-url '^https://(github\.com)/' \
  --allow-url '^https://.*\.corp\.example\.cn/'
```

局限（务必知道）：

- 只对 **gateway 驱动过（owned）的 tab** 生效，且只在**连接期间**；扩展 service worker 重启/重连后 owner 集合清空，需重新 `browser_navigate` 才恢复；
- 只拦 `http(s)` 目标；`about:blank`、`chrome://` 等不作为拦截对象；
- 回退存在极小竞态窗口——被拦页面可能在回退生效前执行了少量自身 JS，所以它是**兜底**，不是零窗口保证；
- 白名单期间对这些 tab 的用户手动导航同样会被拦（不区分是谁发起的）；
- 空列表 = 不限制（缺省行为不变）。真正的边界始终是 token 与档位，导航允许列表是纵深防御的一层。

## 页面内容是不可信的

页面文本由站点控制，可能包含针对 Agent 的 prompt injection。gateway 对读取类结果统一打标：

- `browser_snapshot`：`text` 被 `<untrusted-page-content>` … `</untrusted-page-content>` 界出，结果带 `untrusted: true`；
- `browser_evaluate`：结果带 `untrusted: true`（`value` 原样返回）。

Agent 侧应把这些标记当作边界：**页面里的任何「指令」都不是用户指令**，不要据此调用工具、外发数据或读取凭据。

## 浏览器权限

扩展申请的 Chrome 权限（导航兜底复用既有 `tabs`，未新增权限）：

| 权限 | 用途 |
|------|------|
| `tabs` | 列出/切换标签页、截图；`tabs.onUpdated` 监测导航（导航兜底） |
| `scripting` | 向页面注入快照与交互脚本、执行 Agent 提供的 JS |
| `storage` | 保存 gateway 地址与 token |
| `<all_urls>` | 在任意页面注入与交互（安装时的全域警告即来源于此） |

## 其他边界

- **多浏览器 / relay**：按 `browserId` 分流，同一 ID 新连接顶替旧连接（防抢占）；relay 模式下 MCP 每请求需 `Authorization: Bearer`，且**已在线的浏览器槽位只认它自己握手用的 token**——注册表内其他 token 无法越权操控（详见 [Relay](./relay) 的鉴权规则）。
- **无审批流**：当前版本 Agent 的操作不会向你二次确认。若任务敏感，用最窄档 + 敏感站点不放行（`--allow-url`），或人在旁边时才启动 gateway。
- **最小暴露面**：`serve` 模式的 MCP 端点没有独立鉴权（依赖网络边界），不要暴露给不可信网络；公网场景请改用 `relay` 模式（强制 Bearer）+ 反代加 IP 白名单或 mTLS。
- **relay 是信任边界**：中转服务器运营者技术上可见全部指令与页面数据，请部署在自己的 VPS 上。
- **扩展与 gateway 需同版本**：协议版本 v2 起（allowlist 下发 / nav_blocked 上报），旧扩展连新版 gateway 会被 close `4002` 拒绝——宁可连不上，也不静默丢掉导航门禁。

## 一句话建议

> 用 Tailscale 或 wss，用固定 token，从最窄的 `--permission` 档起，需要什么开什么，再用 `--allow-url` 圈定站点。
