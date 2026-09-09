import { Connection } from "./connection.js";
import { dispatch } from "./router.js";

const connection = new Connection();
connection.onRequest = (req) => dispatch(req.method, req.params);

// SW 每次被唤醒都会重新执行顶层代码；start() 幂等
void connection.start();
chrome.runtime.onInstalled.addListener(() => void connection.start());
chrome.runtime.onStartup.addListener(() => void connection.start());

// popup 查询连接状态（runtime.sendMessage 会唤醒 SW）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "bb-status") {
    sendResponse({ status: connection.status, lastError: connection.lastError });
    return false;
  }
  return false;
});
