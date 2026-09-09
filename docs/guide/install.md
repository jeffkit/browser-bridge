# 安装

安装分两侧：**gateway** 装在 Agent 所在的远程机器上；**浏览器扩展**装在你本地浏览器里。

## 前提

| 要求 | 说明 |
|------|------|
| Node.js ≥ 20 | gateway 运行时（Agent 机器） |
| Chrome / Edge ≥ 116 或 Firefox ≥ 128 | 扩展运行环境 |

网络前提：**本地浏览器能访问 Agent 机器的 gateway 端口**。两者在公网 / 同内网 / Tailscale 等虚拟网均可——方向是「本地 → 远程」出站，所以本地机器不需要公网地址。

::: tip 本地不跑任何服务
本地机器的**唯一组件是浏览器扩展**（一个出站连接的浏览器插件），不需要安装 Node、不需要启动任何进程。下文的 gateway 命令都发生在 **Agent 所在的远程机器**上；只有「双方都在 NAT 后」的 relay 方案才需要额外一台你的公网 VPS（见[公网中转](./relay)）。
:::

## 1. 安装 gateway（Agent 机器）

**方式 A：npx（推荐，免安装）**

```bash
npx browser-bridge-gateway@latest serve --token <你的token>
```

**方式 B：从源码运行**

```bash
git clone https://github.com/jeffkit/browser-bridge.git && cd browser-bridge
pnpm install && pnpm build
node packages/gateway/dist/cli.js serve --token <你的token>
```

`serve` 启动成功后，stderr 日志会打印端口与 MCP 端点：

```
gateway 监听 ws://0.0.0.0:17833（/healthz、/mcp[/:browserId]）
MCP(streamable HTTP) 端点：http://0.0.0.0:17833/mcp
扩展 options 里填：ws://<本机可达地址>:17833 + 上述 token
```

生成随机 token 的快捷方式：`npx browser-bridge-gateway token`。

## 2. 安装浏览器扩展（本地机器）

**方式 A：从 GitHub Releases 下载（推荐）**

1. 打开 [Releases 页面](https://github.com/jeffkit/browser-bridge/releases)，下载对应包：
   - `browser-bridge-extension-chromium-v*.zip` → Chrome / Edge
   - `browser-bridge-extension-firefox-v*.zip` → Firefox
2. 解压到任意**固定目录**（Chromium 扩展以目录形式常驻，别删）；
3. 按 3 / 4 步加载（见下）。

**方式 B：从源码构建**

```bash
git clone https://github.com/jeffkit/browser-bridge.git && cd browser-bridge
pnpm install && pnpm build
# 产物：packages/extension/dist-extension（Chromium）与 dist-extension-firefox（Firefox）
```

**Chrome / Edge 加载：**

1. 地址栏打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角（Edge 为左侧）「**开发者模式**」
3. 点「**加载已解压的扩展程序**」，选择解压出的目录（或源码构建的 `dist-extension`）
4. 工具栏出现 browser-bridge 图标即安装成功

**Firefox 加载（≥ 128）：**

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「**临时载入附加组件…**」，选择解压出的目录里的 `manifest.json`
3. Firefox 差异：
   - 「临时载入」在浏览器重启后失效，长期使用需用 [web-ext](https://github.com/mozilla/web-ext) 签名或自行分发 xpi；
   - `host_permissions` 是**可选权限**：装完到 `about:addons` → browser-bridge → 「权限」页，勾选「**访问所有网站的数据**」，否则无法在普通网页上注入与交互。

::: warning 权限提示
安装时浏览器会提示「**读取和更改您在所有网站上的数据**」——这是全页面操控与截图能力所必需的（详见[安全](./security)）。请只在信任的机器上安装本扩展。
:::

## 3. 验证

- 扩展 popup（点工具栏图标）此时应显示「未连接」——正常，还没配置地址；
- Agent 机器上 `curl http://127.0.0.1:17833/healthz` 返回 `{"ok":true,"connected":false}` 即 gateway 就绪。

下一步：[配置](./configure)——把两端连起来。
