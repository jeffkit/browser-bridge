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
  --token home=<浏览器A的token> --token laptop=<浏览器B的token>
```

`--token` 形如 `<browserId>=<token>`，**每台浏览器一条且必填**；relay 不接受未映射 token（格式/唯一性非法或为空一律启动失败）。扩展用它握手，Agent 控制这台浏览器时 Bearer 也用它（见下方鉴权规则）。**公网部署必须前置 TLS**（caddy 一行配置即可，见下），明文 `ws://` 等于把浏览器操控权暴露给链路窃听者：

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
| Pairing Token | 该浏览器 ID 绑定的那条 token | 必须与 `--token <浏览器ID>=<token>` 一致 |
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

1. **扩展侧**：hello 的 token 必须等于 hello 那台浏览器 ID 绑定的 token（不匹配或浏览器 ID 未映射即断开，4003）；
2. **Agent 侧**：每个 MCP 请求都要 `Authorization: Bearer <token>`；该 token 必须等于 `/mcp/<浏览器ID>` 里那台浏览器绑定的 token（不一致或缺失 → 401）；
3. **槽位绑定**：同一浏览器 ID 只有**持同一 token** 的新连接才能顶替在线旧连接（异 token 一律 4003，且不影响原连接）——**Agent 要控制哪台浏览器，就带那台浏览器的 token**；该浏览器离线时，Bearer 仍必须等于该浏览器 ID 绑定的 token。

::: warning relay 是信任边界
relay 服务器运营者技术上可见全部经过的指令与页面数据。用自己的 VPS、保管好 token；不要连不受信任的第三方 relay。
:::

## 运维速查

- `GET /healthz` → `{ ok: true, browsers: <在线数> }`
- Agent 里 `browser_status` → `browsers` 字段只列出本 token 绑定的那台浏览器（扩展版本一并给出）；
- token 轮换：改 relay 启动参数重启 + 扩展 options 同步改（扩展断连后自动退避重连，改对即恢复）。
