# 更新日志

历史版本（0.3.2 及更早）见 git tag 与 [GitHub Releases](https://github.com/jeffkit/browser-bridge/releases)，此前无 changelog 文件，不补造历史。

## 0.4.0

`0.3.2 → 0.4.0`，按 semver 为 **minor**（项目处于 0.x：破坏性行为/参数变更走 minor，不走 patch）。

### 破坏性变更

- **协议 v2，两侧必须同版本**：`PROTOCOL_VERSION` 升为 `2`，gateway 对协议版本不符的扩展连接直接 `close(4002, "protocol version mismatch")`。升级 gateway 后**必须同步升级扩展**（反之亦然），旧扩展连新版 gateway 会被 4002 拒绝。
- **relay 的 `--token` 改为 `<browserId>=<token>`**：由原来的 `<token>` 改为 `--token <浏览器ID>=<token>`，每台浏览器一条且必填；格式/唯一性非法或为空时 gateway 在**启动时**即报错退出，不再接受未映射的 token。

### 其他变更（非破坏性，便于判断是否升级）

- `--permission` 默认档变为 `read-only`（最窄档）：默认下 `browser_click` / `browser_navigate` / `browser_tab_open` 等动作面需显式开档。
- 新增标签页 owner 校验（`tab_not_owned`）、`--allow-url` 的扩展侧导航兜底回退与 `nav_blocked` 上报、以及离线 MCP Bearer 按 browserId 映射校验——即此前的安全修复现已随 0.4.0 发布。
