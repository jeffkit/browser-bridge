# 安装

安装分两侧：**gateway** 装在 Agent 所在的远程机器上；**浏览器扩展**装在你本地浏览器里。

## 前提

| 要求 | 说明 |
|------|------|
| Node.js ≥ 20 | gateway 运行时（Agent 机器） |
| pnpm ≥ 9 | 从源码构建（`corepack enable` 可启用） |
| Chrome / Edge ≥ 116 | 扩展依赖较新的 service worker 保活语义 |

网络前提：**本地浏览器能访问 Agent 机器的 gateway 端口**。两者在公网 / 同内网 / Tailscale 等虚拟网均可——方向是「本地 → 远程」出站，所以本地机器不需要公网地址。

## 1. 安装 gateway（Agent 机器）

```bash
git clone https://github.com/jeffkit/browser-bridge.git
cd browser-bridge
pnpm install
pnpm build
```

构建产物为 `packages/gateway/dist/`。两种启动方式：

```bash
# 常驻服务：扩展 WS 接入 + MCP streamable HTTP（远程 agent 用这个）
node packages/gateway/dist/cli.js serve --token <你的token>

# 本地 agent：由 agent 以 stdio MCP 拉起（见「配置」页）
node packages/gateway/dist/cli.js mcp --token <你的token>
```

::: tip npm 包
发布到 npm 后可直接 `npx browser-bridge-gateway serve`，届时无需克隆源码。当前请先按上面方式从源码运行。
:::

生成随机 token 的快捷方式：

```bash
node packages/gateway/dist/cli.js token
```

`serve` 启动成功后，stderr 日志会打印端口与 MCP 端点：

```
gateway 监听 ws://0.0.0.0:17833（/healthz、/mcp）
MCP(streamable HTTP) 端点：http://0.0.0.0:17833/mcp
扩展 options 里填：ws://<本机可达地址>:17833 + 上述 token
```

## 2. 安装浏览器扩展（本地机器）

```bash
git clone https://github.com/jeffkit/browser-bridge.git
cd browser-bridge
pnpm install && pnpm build
```

然后在 Chrome / Edge 中加载：

1. 地址栏打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角（Edge 为左侧）「**开发者模式**」
3. 点「**加载已解压的扩展程序**」，选择目录 **`packages/extension/dist-extension`**
4. 工具栏出现 browser-bridge 图标即安装成功

::: warning 权限提示
安装时浏览器会提示「**读取和更改您在所有网站上的数据**」——这是全页面操控与截图能力所必需的（详见[安全](./security)）。请只在信任的机器上安装本扩展。
:::

### Firefox（可选）

Firefox 版产物随同构建（`dist-extension-firefox/`），要求 Firefox ≥ 128：

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「**临时载入附加组件…**」，选择 `dist-extension-firefox/manifest.json`
3. 与 Chromium 版的差异：
   - 背景页是**事件页**（非 service worker），行为一致但「临时载入」在浏览器重启后失效；长期使用需用 [web-ext](https://github.com/mozilla/web-ext) 签名或自行分发 xpi；
   - `host_permissions` 在 Firefox 是**可选权限**：装完到 `about:addons` → browser-bridge → 「权限」页，勾选「**访问所有网站的数据**」，否则无法在普通网页上注入与交互；
   - options 配置流程与 Chromium 完全一致。

## 3. 验证

- 扩展 popup（点工具栏图标）此时应显示「未连接」——正常，还没配置地址；
- Agent 机器上 `curl http://127.0.0.1:17833/healthz` 返回 `{"ok":true,"connected":false}` 即 gateway 就绪。

下一步：[配置](./configure)——把两端连起来。
