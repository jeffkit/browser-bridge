"use strict";
(() => {
  // src/common/api.ts
  var impl = globalThis.browser ?? globalThis.chrome;
  var api = impl;

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
  function takeSnapshot(refs) {
    refs.clear();
    let counter = 0;
    let total = 0;
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
      if (total >= MAX_NODES || depth > MAX_DEPTH) return;
      if (SKIP_TAGS.has(el.tagName)) return;
      if (!isVisible(el)) return;
      const role = roleOf(el);
      if (role === "hidden") return;
      const node = { role, children: [] };
      if (isInteractive(el)) {
        const ref = `@e${++counter}`;
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
    return { url: location.href, title: document.title, text: lines.join("\n"), nodes };
  }

  // src/content/interact.ts
  function resolveElement(refs, ref) {
    const el = refs.get(ref);
    if (!el || !el.isConnected) {
      throw Object.assign(new Error(`\u5143\u7D20\u5F15\u7528 ${ref} \u5DF2\u5931\u6548\uFF08\u9875\u9762\u8DF3\u8F6C\u6216\u5237\u65B0\u540E\u9700\u91CD\u65B0 snapshot\uFF09`), {
        code: "stale_ref"
      });
    }
    return el;
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
  function doClick(refs, ref) {
    const el = resolveElement(refs, ref);
    focusEl(el);
    el.click();
    return { clicked: true, ref };
  }
  function doFill(refs, ref, value) {
    const el = resolveElement(refs, ref);
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
  function doType(refs, ref, text) {
    const el = resolveElement(refs, ref);
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
  function doPress(refs, keySpec, ref) {
    const target = ref ? resolveElement(refs, ref) : document.activeElement ?? document.body;
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
  function doScroll(refs, direction, amount, ref) {
    const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
    const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
    if (ref) {
      const el = resolveElement(refs, ref);
      el.scrollTop += dy;
      el.scrollLeft += dx;
    } else {
      window.scrollBy({ left: dx, top: dy });
    }
    return { scrolled: true };
  }

  // src/content/index.ts
  var ctx = window.__browserBridge ??= { refs: /* @__PURE__ */ new Map() };
  async function handle(method, params) {
    switch (method) {
      case "page.snapshot":
        return takeSnapshot(ctx.refs);
      case "page.click":
        return doClick(ctx.refs, String(params.ref));
      case "page.fill":
        return doFill(ctx.refs, String(params.ref), String(params.value ?? ""));
      case "page.type":
        return doType(ctx.refs, String(params.ref), String(params.text ?? ""));
      case "page.press":
        return doPress(ctx.refs, String(params.key), params.ref !== void 0 ? String(params.ref) : void 0);
      case "page.scroll":
        return doScroll(
          ctx.refs,
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
