# 公网中转（Relay）

「直接连 gateway」要求本地浏览器能访问 Agent 机器。**relay 模式**解决反过来也受限的场景：

- **双方都在 NAT 后**（家里电脑 + 云上 Agent 但没公网 IP）；
- **一人管理多台浏览器**（家里台式机、公司笔记本、平板……全部挂到一个入口）。

思路：在一台公网机器（VPS）上跑 relay，扩展和 Agent **都出站**连它：

```
本地浏览器 A（browserId: home）  ──wss 出站──┐
本地浏览器 B（browserId: laptop）──wss 出站──┼──▶ relay（公网 VPS）◀──wss── Agent（MCP HTTP + Bearer）
                                            │    多 token 注册表
                                            │    按 /mcp/<浏览器ID> 路由
```

## 部署 relay（公网机器）

```bash
git clone https://github.com/jeffkit/browser-bridge.git && cd browser-bridge
pnpm install && pnpm build

node packages/gateway/dist/cli.js relay \
  --token <浏览器A的token> --token <浏览器B的token> --token <agent用的token>
```

`--token` 可重复，形成 token 注册表。**公网部署必须前置 TLS**（caddy 一行配置即可，见下），明文 `ws://` 等于把浏览器操控权暴露给链路窃听者：

```nginx
# caddy 示例
relay.example.com {
  reverse_proxy 127.0.0.1:17833
}
```

## 接入浏览器

每台本地浏览器的扩展 options 里填：

| 字段 | 值 | 说明 |
|------|-----|------|
| Gateway 地址 | `wss://relay.example.com` | relay 地址 |
| Pairing Token | 注册表中的某个 token | 每台浏览器可以用自己的 token |
| **浏览器 ID** | `home` / `laptop` / … | 在 relay 上唯一的设备名，Agent 靠它选目标 |

保存后 popup 变绿即已挂上 relay。

## 接入 Agent

Agent 连 relay 的 MCP 端点，**路径即浏览器 ID**，并带 Bearer：

```json
{
  "mcpServers": {
    "browser-bridge-laptop": {
      "type": "http",
      "url": "https://relay.example.com/mcp/laptop",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

- 工具面与直连 gateway 完全相同，无需改 Agent 的任何用法；
- 想让一个 Agent 会话操作多台浏览器？注册多个 MCP server（同 URL 不同路径），或让 Agent 自己切换。

## 鉴权规则

1. **扩展侧**：hello token 必须在注册表内（不在即断开）；
2. **Agent 侧**：每个 MCP 请求都要 `Authorization: Bearer <token>`，缺省或不在注册表内 → 401；
3. **槽位绑定**：浏览器「laptop」一旦在线，操控它的 Bearer 必须是它握手用的那个 token——**别的注册表 token 无法操控你的浏览器**；浏览器离线时，注册表内任意合法 token 可先建 MCP 会话（真连上浏览器仍需匹配）。

::: warning relay 是信任边界
relay 服务器运营者技术上可见全部经过的指令与页面数据。用自己的 VPS、保管好 token；不要连不受信任的第三方 relay。
:::

## 运维速查

- `GET /healthz` → `{ ok: true, browsers: <在线数> }`
- Agent 里 `browser_status` → `browsers` 字段列出全部在线浏览器与扩展版本；
- token 轮换：改 relay 启动参数重启 + 扩展 options 同步改（扩展断连后自动退避重连，改对即恢复）。
