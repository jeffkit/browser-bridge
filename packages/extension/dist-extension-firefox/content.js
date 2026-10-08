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
    /** snapshot 的 @sN:eM 引用已失效（页面跳转/刷新/新快照使代次过期，或 ref 来自其他 tab） */
    StaleRef: "stale_ref",
    /** 页面脚本执行抛错或返回不可序列化值 */
    EvaluateFailed: "evaluate_failed",
    /** URL 命中 --allow-url 拒绝列表之外 / 未在允许列表内 */
    UrlNotAllowed: "url_not_allowed",
    /** 当前 --permission 档位不允许该工具 */
    PermissionDenied: "permission_denied",
    /** 目标 tab 不是本会话创建/导航过的（owner 校验拒绝） */
    TabNotOwned: "tab_not_owned",
    /** 兜底 */
    Internal: "internal"
  };
  var ErrorCodeHints = {
    [ErrorCode.AuthFailed]: "\u6269\u5C55\u63E1\u624B token \u4E0D\u5339\u914D\uFF0C\u8BF7\u68C0\u67E5\u6269\u5C55 options \u91CC\u914D\u7F6E\u7684 token \u4E0E gateway \u542F\u52A8\u53C2\u6570\u662F\u5426\u4E00\u81F4\u3002",
    [ErrorCode.BrowserDisconnected]: "\u6D4F\u89C8\u5668\u6269\u5C55\u672A\u8FDE\u63A5\u5230 gateway\uFF0C\u8BF7\u5728\u672C\u5730\u6D4F\u89C8\u5668\u6253\u5F00\u6269\u5C55\u5E76\u786E\u8BA4 options \u91CC\u7684 gateway \u5730\u5740\u3002",
    [ErrorCode.Timeout]: "\u6269\u5C55\u54CD\u5E94\u8D85\u65F6\uFF0C\u9875\u9762\u53EF\u80FD\u5361\u6B7B\u6216\u6D4F\u89C8\u5668\u5FD9\u788C\uFF0C\u53EF\u91CD\u8BD5\u6216\u52A0\u5927 timeoutMs\u3002",
    [ErrorCode.TabNotFound]: "\u76EE\u6807 tab \u5DF2\u5173\u95ED\uFF0C\u5148 browser_tab_list \u83B7\u53D6\u5F53\u524D\u6709\u6548 tab\u3002",
    [ErrorCode.PageNotInjectable]: "\u8BE5\u9875\u9762\u4E0D\u5141\u8BB8\u6CE8\u5165\u811A\u672C\uFF08\u5982 chrome:// \u7F51\u4E0A\u5E94\u7528\u5E97\u3001PDF \u67E5\u770B\u5668\uFF09\uFF0C\u8BF7\u6362\u666E\u901A\u7F51\u9875\u3002",
    [ErrorCode.StaleRef]: "\u5143\u7D20\u5F15\u7528\u5DF2\u5931\u6548\uFF08\u9875\u9762\u8DF3\u8F6C/\u5237\u65B0\uFF0C\u6216\u5FEB\u7167\u5DF2\u88AB\u65B0\u5FEB\u7167\u53D6\u4EE3\uFF09\u3002\u8BF7\u5BF9\u76EE\u6807 tab \u91CD\u65B0 browser_snapshot\uFF0C\u5E76\u4F7F\u7528\u6700\u65B0\u4E00\u6B21\u5FEB\u7167\u8FD4\u56DE\u7684 ref\u3002",
    [ErrorCode.UrlNotAllowed]: "\u76EE\u6807 URL \u4E0D\u5728 gateway \u7684 --allow-url \u5141\u8BB8\u5217\u8868\u5185\uFF08\u5BFC\u822A\u515C\u5E95\u62E6\u622A\u4E5F\u4F1A\u8FD4\u56DE\u6B64\u7801\uFF09\uFF1B\u6539\u7528\u5141\u8BB8\u7684\u7AD9\u70B9\uFF0C\u6216\u8C03\u6574 gateway \u542F\u52A8\u53C2\u6570\u3002",
    [ErrorCode.PermissionDenied]: "\u5F53\u524D\u6743\u9650\u6863\u4E0D\u5141\u8BB8\u8BE5\u52A8\u4F5C\u3002gateway \u9ED8\u8BA4\u6700\u7A84\u6863 read-only\uFF1A\u9700\u8981\u9875\u9762\u4EA4\u4E92\uFF08click/fill/type/press/navigate/tab_open\uFF09\u8BF7\u7528 --permission navigate-allowlist\uFF0C\u9700\u8981 browser_evaluate \u8BF7\u7528 --permission full\u3002",
    [ErrorCode.TabNotOwned]: "\u76EE\u6807 tabId \u4E0D\u662F\u672C\u4F1A\u8BDD\u521B\u5EFA/\u5BFC\u822A\u8FC7\u7684\u6807\u7B7E\u9875\uFF0C\u9ED8\u8BA4\u62D2\u7EDD\uFF1B\u786E\u9700\u64CD\u4F5C\u6D4F\u89C8\u5668\u91CC\u5DF2\u6709\u7684\u6807\u7B7E\u9875\uFF0C\u7528 --allow-foreign-tabs \u542F\u52A8 gateway\u3002"
  };

  // ../protocol/dist/messages.js
  var REF_PATTERN = /^@s(\d+):e(\d+)$/;
  function parseRef(ref) {
    const m = REF_PATTERN.exec(ref);
    if (!m)
      return null;
    const gen = Number(m[1]);
    const index = Number(m[2]);
    if (!Number.isInteger(gen) || !Number.isInteger(index))
      return null;
    return { gen, index };
  }
  function makeRef(gen, index) {
    return `@s${gen}:e${index}`;
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

  // src/content/snapshot.ts
  var SKIP_TAGS = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "HEAD"]);
  var MAX_NODES = 800;
  var MAX_DEPTH = 20;
  var MAX_TEXT = 100;
  var INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
    "button",
    "link",
    "checkbox",
    "radio",
    "tab",
    "menuitem",
    "option",
    "combobox",
    "slider",
    "switch",
    "searchbox",
    "textbox"
  ]);
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }
  function explicitRole(el) {
    const role = el.getAttribute("role");
    return role ? role.toLowerCase() : null;
  }
  function implicitRole(el) {
    const tag = el.tagName;
    if (tag === "A") return "link";
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "IMG") return "image";
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "button" || type === "submit" || type === "reset") return "button";
      if (type === "hidden") return "hidden";
      return "textbox";
    }
    if (/^H[1-6]$/.test(tag)) return "heading";
    return "generic";
  }
  function roleOf(el) {
    return explicitRole(el) ?? implicitRole(el);
  }
  function isInteractive(el) {
    const tag = el.tagName;
    if (tag === "A" && el.hasAttribute("href")) return true;
    if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY") return true;
    if (tag === "INPUT" && (el.getAttribute("type") ?? "text").toLowerCase() !== "hidden") return true;
    if (el.getAttribute("onclick") != null) return true;
    if (el.getAttribute("contenteditable") != null || el.isContentEditable) return true;
    if (el.hasAttribute("tabindex")) return true;
    const role = explicitRole(el);
    return role !== null && INTERACTIVE_ROLES.has(role);
  }
  function directText(el) {
    let text = "";
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
    }
    text = text.replace(/\s+/g, " ").trim();
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\u2026` : text;
  }
  function nameOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const tag = el.tagName;
    if (tag === "IMG") return el.getAttribute("alt") ?? void 0;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) return placeholder;
      const byId = el.getAttribute("id");
      if (byId) {
        const label = document.querySelector(`label[for="${CSS.escape(byId)}"]`);
        if (label?.textContent) return label.textContent.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      }
      const wrapped = el.closest("label");
      if (wrapped?.textContent) return wrapped.textContent.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      return void 0;
    }
    const own = directText(el);
    if (own) return own;
    const value = el.value;
    if (typeof value === "string" && value) return value.slice(0, MAX_TEXT);
    return void 0;
  }
  function takeSnapshot(refs, gen) {
    refs.clear();
    let counter = 0;
    let total = 0;
    let truncated = false;
    const nodes = [];
    const lines = [`# ${document.title} (${location.href})`];
    const render = (node, depth) => {
      const parts = [
        "-",
        node.ref ?? "",
        node.role,
        node.name !== void 0 ? JSON.stringify(node.name) : "",
        node.value !== void 0 ? `value=${JSON.stringify(node.value)}` : ""
      ].filter((s) => s !== "");
      const flags = [];
      if (node.checked) flags.push("checked");
      if (node.disabled) flags.push("disabled");
      if (node.focused) flags.push("focused");
      lines.push(`${"  ".repeat(depth)}${parts.join(" ")}${flags.length ? ` [${flags.join(",")}]` : ""}`);
      for (const child of node.children) render(child, depth + 1);
    };
    const walk = (el, out, depth) => {
      if (total >= MAX_NODES || depth > MAX_DEPTH) {
        truncated = true;
        return;
      }
      if (SKIP_TAGS.has(el.tagName)) return;
      if (!isVisible(el)) return;
      const role = roleOf(el);
      if (role === "hidden") return;
      const node = { role, children: [] };
      if (isInteractive(el)) {
        const ref = makeRef(gen, ++counter);
        node.ref = ref;
        refs.set(ref, el);
      }
      const name = nameOf(el);
      if (name) node.name = name;
      const tag = el.tagName;
      if ((tag === "INPUT" || tag === "TEXTAREA") && el.value) {
        node.value = el.value.slice(0, MAX_TEXT);
      }
      if (el.checked === true || el.getAttribute("aria-checked") === "true") {
        node.checked = true;
      }
      if (el.disabled === true || el.getAttribute("aria-disabled") === "true") {
        node.disabled = true;
      }
      if (el === document.activeElement) node.focused = true;
      out.push(node);
      total++;
      for (const child of el.children) walk(child, node.children, depth + 1);
      if (node.children.length === 0 && node.name === void 0) {
        const own = directText(el);
        if (own) node.name = own;
      }
    };
    if (document.body) walk(document.body, nodes, 0);
    for (const node of nodes) render(node, 0);
    return { url: location.href, title: document.title, gen, text: lines.join("\n"), nodes, truncated };
  }

  // src/content/interact.ts
  function resolveElement(refs, gen, ref) {
    const parsed = parseRef(ref);
    if (!parsed || parsed.gen !== gen || parsed.index < 1) {
      throw staleRef(ref, `\u5F15\u7528 ${ref} \u4E0D\u662F\u672C\u9875\u9762\u5F53\u524D\u5FEB\u7167\uFF08\u4EE3\u6B21 ${gen}\uFF09\u7684\u5143\u7D20\uFF0C\u8BF7\u91CD\u65B0 snapshot`);
    }
    const el = refs.get(ref);
    if (!el || !el.isConnected) {
      throw staleRef(ref, `\u5143\u7D20\u5F15\u7528 ${ref} \u5DF2\u5931\u6548\uFF08\u9875\u9762\u8DF3\u8F6C\u6216\u5237\u65B0\u540E\u9700\u91CD\u65B0 snapshot\uFF09`);
    }
    return el;
  }
  function staleRef(ref, message) {
    return Object.assign(new Error(message), { code: "stale_ref", ref });
  }
  function focusEl(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    if (typeof el.focus === "function") {
      el.focus();
    }
  }
  function setValueAndEvents(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function doClick(refs, gen, ref) {
    const el = resolveElement(refs, gen, ref);
    focusEl(el);
    el.click();
    return { clicked: true, ref };
  }
  function doFill(refs, gen, ref, value) {
    const el = resolveElement(refs, gen, ref);
    focusEl(el);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setValueAndEvents(el, value);
    } else if (el instanceof HTMLSelectElement) {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      const target = el;
      target.focus();
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
    } else {
      const generic = el;
      generic.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { filled: true, ref };
  }
  function doType(refs, gen, ref, text) {
    const el = resolveElement(refs, gen, ref);
    focusEl(el);
    if (el.isContentEditable) {
      document.execCommand("insertText", false, text);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      for (const ch of text) {
        setValueAndEvents(el, el.value + ch);
      }
    } else {
      throw Object.assign(new Error(`\u5143\u7D20 ${ref} \u4E0D\u662F\u53EF\u8F93\u5165\u5143\u7D20`), { code: "page_action_failed" });
    }
    return { typed: true, ref };
  }
  function parseKey(spec) {
    const parts = spec.split("+").map((s) => s.trim());
    const key = parts.pop() ?? spec;
    const lower = parts.map((p) => p.toLowerCase());
    return {
      key,
      ctrlKey: lower.includes("control") || lower.includes("ctrl"),
      shiftKey: lower.includes("shift"),
      altKey: lower.includes("alt") || lower.includes("option"),
      metaKey: lower.includes("meta") || lower.includes("command") || lower.includes("cmd")
    };
  }
  function doPress(refs, gen, keySpec, ref) {
    const target = ref ? resolveElement(refs, gen, ref) : document.activeElement ?? document.body;
    if (ref) focusEl(target);
    const parsed = parseKey(keySpec);
    const init = {
      ...parsed,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    return { pressed: true };
  }
  function doScroll(refs, gen, direction, amount, ref) {
    const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
    const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
    if (ref) {
      const el = resolveElement(refs, gen, ref);
      el.scrollTop += dy;
      el.scrollLeft += dx;
    } else {
      window.scrollBy({ left: dx, top: dy });
    }
    return { scrolled: true };
  }

  // src/content/index.ts
  var ctx = window.__browserBridge ??= {
    refs: /* @__PURE__ */ new Map(),
    snapshotGen: 0
  };
  async function handle(method, params) {
    switch (method) {
      case "page.snapshot": {
        const gen = ++ctx.snapshotGen;
        return takeSnapshot(ctx.refs, gen);
      }
      case "page.click":
        return doClick(ctx.refs, ctx.snapshotGen, String(params.ref));
      case "page.fill":
        return doFill(ctx.refs, ctx.snapshotGen, String(params.ref), String(params.value ?? ""));
      case "page.type":
        return doType(ctx.refs, ctx.snapshotGen, String(params.ref), String(params.text ?? ""));
      case "page.press":
        return doPress(
          ctx.refs,
          ctx.snapshotGen,
          String(params.key),
          params.ref !== void 0 ? String(params.ref) : void 0
        );
      case "page.scroll":
        return doScroll(
          ctx.refs,
          ctx.snapshotGen,
          params.direction ?? "down",
          Number(params.amount) || 600,
          params.ref !== void 0 ? String(params.ref) : void 0
        );
      default:
        throw Object.assign(new Error(`\u672A\u77E5\u9875\u9762\u65B9\u6CD5\uFF1A${method}`), { code: "method_not_found" });
    }
  }
  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "bb-probe") {
      sendResponse({ injected: true });
      return false;
    }
    if (msg.type === "bb-request" && typeof msg.method === "string") {
      void handle(msg.method, msg.params ?? {}).then(
        (result) => sendResponse({ ok: true, result }),
        (err) => sendResponse({
          ok: false,
          error: { code: err?.code ?? "page_action_failed", message: err instanceof Error ? err.message : String(err) }
        })
      );
      return true;
    }
    return false;
  });
})();
