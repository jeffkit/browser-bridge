import { api } from "../common/api.js";
import { Connection } from "./connection.js";
import { navGuard } from "./nav-guard.js";
import { dispatch } from "./router.js";

const connection = new Connection();
connection.onRequest = (req) => dispatch(req.method, req.params);

// 导航兜底：允许列表由 gateway 在 hello 后下发（connection 处理 allowlist 消息），
// 越界导航在扩展侧被 tabs.onUpdated 拦下并上报，gateway 侧可经 browser_status 看到
navGuard.install();
navGuard.onBlocked = (info) => connection.send({ type: "nav_blocked", ...info });

// SW 每次被唤醒都会重新执行顶层代码；start() 幂等
void connection.start();
api.runtime.onInstalled.addListener(() => void connection.start());
api.runtime.onStartup.addListener(() => void connection.start());

// popup 查询连接状态（runtime.sendMessage 会唤醒 SW）
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "bb-status") {
    sendResponse({ status: connection.status, lastError: connection.lastError });
    return false;
  }
  return false;
});
