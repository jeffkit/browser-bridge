"use strict";
(() => {
  // src/common/api.ts
  var impl = globalThis.browser ?? globalThis.chrome;
  var api = impl;

  // ../protocol/dist/errors.js
  var ErrorCode = {
    /** hello 鉴权失败（token 不匹配） */
    AuthFailed: "auth_failed",
    /** gateway 收到请求时浏览器扩展未连接 */
    BrowserDisconnected: "browser_disconnected",
    /** 请求等待扩展响应超时 */
    Timeout: "timeout",
    /** 未知方法 */
    MethodNotFound: "method_not_found",
    /** 参数缺失或非法 */
    BadParams: "bad_params",
    /** 目标 tab 不存在或已关闭 */
    TabNotFound: "tab_not_found",
    /** 截图失败（通常是无可见 tab 或权限问题） */
    ScreenshotFailed: "screenshot_failed",
    /** 导航在超时窗口内未达到目标状态 */
    NavigationTimeout: "navigation_timeout",
    /** content script 未注入 / 页面不可注入（chrome:// 等受限页） */
    PageNotInjectable: "page_not_injectable",
    /** 页面内操作失败（元素消失、选择器失效等） */
    PageActionFailed: "page_action_failed",
    /** snapshot 的 @eN 引用已失效（页面跳转/刷新后缓存清空） */
    StaleRef: "stale_ref",
    /** 页面脚本执行抛错或返回不可序列化值 */
    EvaluateFailed: "evaluate_failed",
    /** URL 命中 --allow-url 拒绝列表之外 / 未在允许列表内 */
    UrlNotAllowed: "url_not_allowed",
    /** 兜底 */
    Internal: "internal"
  };
  var ErrorCodeHints = {
    [ErrorCode.AuthFailed]: "\u6269\u5C55\u63E1\u624B token \u4E0D\u5339\u914D\uFF0C\u8BF7\u68C0\u67E5\u6269\u5C55 options \u91CC\u914D\u7F6E\u7684 token \u4E0E gateway \u542F\u52A8\u53C2\u6570\u662F\u5426\u4E00\u81F4\u3002",
    [ErrorCode.BrowserDisconnected]: "\u6D4F\u89C8\u5668\u6269\u5C55\u672A\u8FDE\u63A5\u5230 gateway\uFF0C\u8BF7\u5728\u672C\u5730\u6D4F\u89C8\u5668\u6253\u5F00\u6269\u5C55\u5E76\u786E\u8BA4 options \u91CC\u7684 gateway \u5730\u5740\u3002",
    [ErrorCode.Timeout]: "\u6269\u5C55\u54CD\u5E94\u8D85\u65F6\uFF0C\u9875\u9762\u53EF\u80FD\u5361\u6B7B\u6216\u6D4F\u89C8\u5668\u5FD9\u788C\uFF0C\u53EF\u91CD\u8BD5\u6216\u52A0\u5927 timeoutMs\u3002",
    [ErrorCode.TabNotFound]: "\u76EE\u6807 tab \u5DF2\u5173\u95ED\uFF0C\u5148 browser_tab_list \u83B7\u53D6\u5F53\u524D\u6709\u6548 tab\u3002",
    [ErrorCode.PageNotInjectable]: "\u8BE5\u9875\u9762\u4E0D\u5141\u8BB8\u6CE8\u5165\u811A\u672C\uFF08\u5982 chrome:// \u7F51\u4E0A\u5E94\u7528\u5E97\u3001PDF \u67E5\u770B\u5668\uFF09\uFF0C\u8BF7\u6362\u666E\u901A\u7F51\u9875\u3002",
    [ErrorCode.StaleRef]: "\u5143\u7D20\u5F15\u7528\u5DF2\u5931\u6548\uFF08\u9875\u9762\u8DF3\u8F6C\u6216\u5237\u65B0\uFF09\uFF0C\u8BF7\u91CD\u65B0 browser_snapshot\u3002"
  };

  // ../protocol/dist/messages.js
  var PROTOCOL_VERSION = 1;
  var HEARTBEAT_INTERVAL_MS = 2e4;
  function parseWireMessage(raw) {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null)
      return null;
    const type = value.type;
    switch (type) {
      case "hello":
      case "ping":
      case "pong":
      case "request":
      case "result":
        return value;
      default:
        return null;
    }
  }

  // ../protocol/dist/methods.js
  var Method = {
    Ping: "ping",
    TabsList: "tabs.list",
    TabsGet: "tabs.get",
    TabsCreate: "tabs.create",
    TabsClose: "tabs.close",
    TabsActivate: "tabs.activate",
    TabsNavigate: "tabs.navigate",
    TabsScreenshot: "tabs.screenshot",
    PageSnapshot: "page.snapshot",
    PageClick: "page.click",
    PageFill: "page.fill",
    PageType: "page.type",
    PagePress: "page.press",
    PageScroll: "page.scroll",
    PageEvaluate: "page.evaluate"
  };
  var DefaultTimeoutMs = {
    [Method.Ping]: 5e3,
    [Method.TabsList]: 1e4,
    [Method.TabsGet]: 1e4,
    [Method.TabsCreate]: 1e4,
    [Method.TabsClose]: 1e4,
    [Method.TabsActivate]: 1e4,
    [Method.TabsNavigate]: 2e4,
    [Method.TabsScreenshot]: 15e3,
    [Method.PageSnapshot]: 3e4,
    [Method.PageClick]: 15e3,
    [Method.PageFill]: 15e3,
    [Method.PageType]: 15e3,
    [Method.PagePress]: 15e3,
    [Method.PageScroll]: 15e3,
    [Method.PageEvaluate]: 3e4
  };

  // src/common/config.ts
  var STORAGE_KEY = "config";
  async function loadConfig() {
    const obj = await api.storage.local.get(STORAGE_KEY);
    const cfg = obj[STORAGE_KEY] ?? {};
    return {
      gatewayUrl: cfg.gatewayUrl ?? "",
      token: cfg.token ?? "",
      browserId: cfg.browserId ?? ""
    };
  }
  function onConfigChanged(cb) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) {
        const cfg = changes[STORAGE_KEY].newValue;
        cb({
          gatewayUrl: cfg?.gatewayUrl ?? "",
          token: cfg?.token ?? "",
          browserId: cfg?.browserId ?? ""
        });
      }
    });
  }

  // src/service-worker/connection.ts
  var Connection = class {
    status = "disconnected";
    lastError = "";
    /** 收到 gateway 命令时的处理器（router.dispatch） */
    onRequest = null;
    ws = null;
    heartbeat = null;
    reconnectTimer = null;
    backoffMs = 1e3;
    cfg = { gatewayUrl: "", token: "", browserId: "" };
    started = false;
    async start() {
      if (this.started) return;
      this.started = true;
      this.cfg = await loadConfig();
      onConfigChanged((cfg) => {
        this.cfg = cfg;
        this.log("\u914D\u7F6E\u5DF2\u66F4\u65B0\uFF0C\u91CD\u8FDE\u4E2D\u2026");
        this.teardown();
        this.scheduleReconnect(0);
      });
      this.connect();
    }
    log(msg2) {
      console.log(`[browser-bridge] ${msg2}`);
    }
    connect() {
      const { gatewayUrl, token } = this.cfg;
      if (!gatewayUrl || !token) {
        this.status = "disconnected";
        this.lastError = "\u5C1A\u672A\u914D\u7F6E gateway \u5730\u5740\u6216 token\uFF0C\u8BF7\u6253\u5F00\u6269\u5C55\u8BBE\u7F6E";
        return;
      }
      this.status = "connecting";
      this.lastError = "";
      let ws;
      try {
        ws = new WebSocket(gatewayUrl);
      } catch (err) {
        this.status = "error";
        this.lastError = `gateway \u5730\u5740\u65E0\u6548\uFF1A${String(err)}`;
        this.scheduleReconnect();
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        const hello = {
          type: "hello",
          proto: PROTOCOL_VERSION,
          auth: token,
          client: { name: "browser-bridge-extension", version: api.runtime.getManifest().version },
          browserId: this.cfg.browserId.trim() || void 0
        };
        ws.send(JSON.stringify(hello));
        this.status = "connected";
        this.backoffMs = 1e3;
        this.log(`\u5DF2\u8FDE\u63A5 ${gatewayUrl}`);
        this.startHeartbeat(ws);
      };
      ws.onmessage = (event) => {
        const msg2 = parseWireMessage(String(event.data));
        if (!msg2) return;
        if (msg2.type === "pong") return;
        if (msg2.type === "request") {
          void this.handleRequest(ws, msg2);
        }
      };
      ws.onclose = (event) => {
        if (this.ws === ws) {
          this.status = "disconnected";
          this.lastError = `\u8FDE\u63A5\u5173\u95ED\uFF08code=${event.code}\uFF09`;
          this.stopHeartbeat();
          this.ws = null;
          this.scheduleReconnect(event.code === 4002 || event.code === 4003 ? 3e4 : void 0);
        }
      };
      ws.onerror = () => {
        if (this.ws === ws) {
          this.status = "error";
          this.lastError = "\u8FDE\u63A5\u5931\u8D25\uFF08\u5730\u5740\u4E0D\u53EF\u8FBE\u6216 TLS \u95EE\u9898\uFF09";
        }
      };
    }
    async handleRequest(ws, req) {
      let result;
      if (!this.onRequest) {
        result = { type: "result", id: req.id, ok: false, error: { code: "internal", message: "router \u672A\u5C31\u7EEA" } };
      } else {
        try {
          const value = await this.onRequest(req);
          result = { type: "result", id: req.id, ok: true, result: value };
        } catch (err) {
          const e = err;
          result = {
            type: "result",
            id: req.id,
            ok: false,
            error: { code: e?.code ?? "internal", message: e?.message ?? String(err) }
          };
        }
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(result));
      }
    }
    startHeartbeat(ws) {
      this.stopHeartbeat();
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, HEARTBEAT_INTERVAL_MS);
    }
    stopHeartbeat() {
      if (this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    }
    teardown() {
      this.stopHeartbeat();
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) {
        const ws = this.ws;
        this.ws = null;
        ws.onclose = null;
        ws.close(1e3, "reconfigure");
      }
    }
    scheduleReconnect(delayMs) {
      if (this.reconnectTimer) return;
      const delay = delayMs ?? this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, 3e4);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }
  };

  // src/service-worker/router.ts
  function fail(code, message) {
    throw Object.assign(new Error(message), { code });
  }
  function msg(err) {
    return err instanceof Error ? err.message : String(err);
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function tabInfo(tab) {
    return {
      id: tab.id ?? -1,
      windowId: tab.windowId,
      title: tab.title ?? "",
      url: tab.url ?? "",
      active: tab.active ?? false
    };
  }
  async function resolveTab(tabId) {
    if (typeof tabId === "number") {
      try {
        return await api.tabs.get(tabId);
      } catch {
        fail("tab_not_found", `tab ${tabId} \u4E0D\u5B58\u5728\u6216\u5DF2\u5173\u95ED`);
      }
    }
    const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || typeof tab.id !== "number") {
      fail("tab_not_found", "\u627E\u4E0D\u5230\u6D3B\u8DC3\u6807\u7B7E\u9875");
    }
    return tab;
  }
  async function navigate(p) {
    const tab = await resolveTab(p.tabId);
    const tabId = tab.id;
    await api.tabs.update(tabId, { url: p.url });
    const waitFor = p.waitFor ?? "load";
    if (waitFor === "none") {
      return { tabId, url: p.url, title: tab.title ?? "", status: "complete" };
    }
    const timeoutMs = Math.min(Number(p.timeoutMs) || 15e3, 6e4);
    await Promise.race([
      new Promise((resolve) => {
        const listener = (id) => {
          if (id === tabId) {
            api.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        api.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 800);
      })
    ]);
    const deadline = Date.now() + timeoutMs;
    let reached = false;
    while (Date.now() < deadline) {
      const ready = await pageReadyState(tabId);
      if (ready === "complete" || waitFor === "domcontentloaded" && ready === "interactive") {
        reached = true;
        break;
      }
      await sleep(200);
    }
    let title = tab.title ?? "";
    try {
      const after = await api.tabs.get(tabId);
      title = after.title ?? title;
    } catch {
      fail("tab_not_found", `\u5BFC\u822A\u8FC7\u7A0B\u4E2D tab ${tabId} \u88AB\u5173\u95ED`);
    }
    return { tabId, url: p.url, title, status: reached ? "complete" : "timeout" };
  }
  async function pageReadyState(tabId) {
    try {
      const results = await api.scripting.executeScript({
        target: { tabId },
        func: () => document.readyState
      });
      return results[0]?.result ?? null;
    } catch {
      return null;
    }
  }
  async function screenshot(p) {
    const tab = await resolveTab(p.tabId);
    const tabId = tab.id;
    if (!tab.active) {
      await api.tabs.update(tabId, { active: true });
      await sleep(300);
    }
    try {
      const dataUrl = await api.tabs.captureVisibleTab(tab.windowId, {
        format: p.jpegQuality != null ? "jpeg" : "png",
        quality: p.jpegQuality != null ? Math.min(100, Math.max(0, p.jpegQuality)) : void 0
      });
      return { tabId, dataUrl };
    } catch (err) {
      fail("screenshot_failed", `\u622A\u56FE\u5931\u8D25\uFF1A${msg(err)}`);
    }
  }
  async function sendToTab(tabId, message) {
    try {
      return await api.tabs.sendMessage(tabId, message);
    } catch (err) {
      fail("page_not_injectable", `\u9875\u9762\u901A\u4FE1\u5931\u8D25\uFF08\u53EF\u80FD\u672A\u6CE8\u5165\u6216\u9875\u9762\u53D7\u9650\uFF09\uFF1A${msg(err)}`);
    }
  }
  async function ensureInjected(tabId) {
    const probe = await api.tabs.sendMessage(tabId, { type: "bb-probe" }).catch(() => null);
    if (probe && probe.injected) return;
    try {
      await api.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch (err) {
      fail("page_not_injectable", `\u65E0\u6CD5\u6CE8\u5165\u811A\u672C\uFF08chrome:// \u7B49\u53D7\u9650\u9875\u9762\u4E0D\u652F\u6301\uFF09\uFF1A${msg(err)}`);
    }
  }
  async function pageCall(tabIdParam, method, params) {
    const tab = await resolveTab(tabIdParam);
    const tabId = tab.id;
    await ensureInjected(tabId);
    const resp = await sendToTab(tabId, { type: "bb-request", method, params });
    if (!resp || typeof resp !== "object") {
      fail("page_action_failed", "content script \u65E0\u54CD\u5E94");
    }
    if (resp.ok) {
      if (method === "page.snapshot" && resp.result && typeof resp.result === "object") {
        return { tabId: tab.id, ...resp.result };
      }
      return resp.result;
    }
    fail(resp.error?.code ?? "page_action_failed", resp.error?.message ?? "\u9875\u9762\u64CD\u4F5C\u5931\u8D25");
  }
  async function evaluate(p) {
    const tab = await resolveTab(p.tabId);
    const tabId = tab.id;
    let fn;
    try {
      const parsed = new Function(`return (${p.fn})`)();
      if (typeof parsed !== "function") throw new Error("fn \u5FC5\u987B\u662F\u51FD\u6570\u8868\u8FBE\u5F0F");
      fn = parsed;
    } catch (err) {
      fail("bad_params", `fn \u975E\u6CD5\uFF1A${msg(err)}`);
    }
    try {
      const results = await api.scripting.executeScript({
        target: { tabId },
        world: p.world === "MAIN" ? "MAIN" : "ISOLATED",
        func: fn,
        args: p.args ?? []
      });
      return { value: results[0]?.result };
    } catch (err) {
      fail("evaluate_failed", `\u9875\u9762\u811A\u672C\u6267\u884C\u5931\u8D25\uFF1A${msg(err)}`);
    }
  }
  async function dispatch(method, rawParams) {
    const params = rawParams ?? {};
    switch (method) {
      case "ping":
        return { pong: true, echo: params.echo, ts: Date.now() };
      case "tabs.list": {
        const tabs = await api.tabs.query({});
        return { tabs: tabs.filter((t) => typeof t.id === "number" && t.id >= 0).map(tabInfo) };
      }
      case "tabs.get":
        return { tab: tabInfo(await resolveTab(params.tabId)) };
      case "tabs.create": {
        const tab = await api.tabs.create({
          url: params.url,
          active: params.active ?? true
        });
        return { tab: tabInfo(tab) };
      }
      case "tabs.close":
        await api.tabs.remove(params.tabId);
        return { closed: true };
      case "tabs.activate": {
        const tabId = params.tabId;
        await api.tabs.update(tabId, { active: true });
        return { tab: tabInfo(await api.tabs.get(tabId)) };
      }
      case "tabs.navigate":
        return navigate(params);
      case "tabs.screenshot":
        return screenshot(params);
      case "page.snapshot":
        return pageCall(params.tabId, method, params);
      case "page.click":
        return pageCall(params.tabId, method, params);
      case "page.fill":
        return pageCall(params.tabId, method, params);
      case "page.type":
        return pageCall(params.tabId, method, params);
      case "page.press":
        return pageCall(params.tabId, method, params);
      case "page.scroll":
        return pageCall(params.tabId, method, params);
      case "page.evaluate":
        return evaluate(
          params
        );
      default:
        fail("method_not_found", `\u672A\u77E5\u65B9\u6CD5\uFF1A${method}`);
    }
  }

  // src/service-worker/index.ts
  var connection = new Connection();
  connection.onRequest = (req) => dispatch(req.method, req.params);
  void connection.start();
  api.runtime.onInstalled.addListener(() => void connection.start());
  api.runtime.onStartup.addListener(() => void connection.start());
  api.runtime.onMessage.addListener((msg2, _sender, sendResponse) => {
    if (msg2?.type === "bb-status") {
      sendResponse({ status: connection.status, lastError: connection.lastError });
      return false;
    }
    return false;
  });
})();
