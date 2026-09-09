import type { SnapshotNode } from "@browser-bridge/protocol";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "HEAD"]);
const MAX_NODES = 800;
const MAX_DEPTH = 20;
const MAX_TEXT = 100;

const INTERACTIVE_ROLES = new Set([
  "button", "link", "checkbox", "radio", "tab", "menuitem", "option", "combobox", "slider", "switch", "searchbox", "textbox",
]);

interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  nodes: SnapshotNode[];
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function explicitRole(el: Element): string | null {
  const role = el.getAttribute("role");
  return role ? role.toLowerCase() : null;
}

function implicitRole(el: Element): string {
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

function roleOf(el: Element): string {
  return explicitRole(el) ?? implicitRole(el);
}

function isInteractive(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "A" && el.hasAttribute("href")) return true;
  if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY") return true;
  if (tag === "INPUT" && (el.getAttribute("type") ?? "text").toLowerCase() !== "hidden") return true;
  if (el.getAttribute("onclick") != null) return true;
  if (el.getAttribute("contenteditable") != null || (el as HTMLElement).isContentEditable) return true;
  if (el.hasAttribute("tabindex")) return true;
  const role = explicitRole(el);
  return role !== null && INTERACTIVE_ROLES.has(role);
}

function directText(el: Element): string {
  let text = "";
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? "";
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function nameOf(el: Element): string | undefined {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const tag = el.tagName;
  if (tag === "IMG") return el.getAttribute("alt") ?? undefined;
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
    return undefined;
  }
  const own = directText(el);
  if (own) return own;
  const value = (el as HTMLInputElement).value;
  if (typeof value === "string" && value) return value.slice(0, MAX_TEXT);
  return undefined;
}

export function takeSnapshot(refs: Map<string, Element>): PageSnapshot {
  refs.clear();
  let counter = 0;
  let total = 0;
  const nodes: SnapshotNode[] = [];
  const lines: string[] = [`# ${document.title} (${location.href})`];

  const render = (node: SnapshotNode, depth: number): void => {
    const parts = [
      "-",
      node.ref ?? "",
      node.role,
      node.name !== undefined ? JSON.stringify(node.name) : "",
      node.value !== undefined ? `value=${JSON.stringify(node.value)}` : "",
    ].filter((s) => s !== "");
    const flags: string[] = [];
    if (node.checked) flags.push("checked");
    if (node.disabled) flags.push("disabled");
    if (node.focused) flags.push("focused");
    lines.push(`${"  ".repeat(depth)}${parts.join(" ")}${flags.length ? ` [${flags.join(",")}]` : ""}`);
    for (const child of node.children) render(child, depth + 1);
  };

  const walk = (el: Element, out: SnapshotNode[], depth: number): void => {
    if (total >= MAX_NODES || depth > MAX_DEPTH) return;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (!isVisible(el)) return;

    const role = roleOf(el);
    if (role === "hidden") return;

    const node: SnapshotNode = { role, children: [] };
    if (isInteractive(el)) {
      const ref = `@e${++counter}`;
      node.ref = ref;
      refs.set(ref, el);
    }
    const name = nameOf(el);
    if (name) node.name = name;
    const tag = el.tagName;
    if ((tag === "INPUT" || tag === "TEXTAREA") && (el as HTMLInputElement).value) {
      node.value = (el as HTMLInputElement).value.slice(0, MAX_TEXT);
    }
    if ((el as HTMLInputElement).checked === true || el.getAttribute("aria-checked") === "true") {
      node.checked = true;
    }
    if ((el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true") {
      node.disabled = true;
    }
    if (el === document.activeElement) node.focused = true;

    out.push(node);
    total++;

    for (const child of el.children) walk(child, node.children, depth + 1);
    if (node.children.length === 0 && node.name === undefined) {
      const own = directText(el);
      if (own) node.name = own;
    }
  };

  if (document.body) walk(document.body, nodes, 0);
  for (const node of nodes) render(node, 0);
  return { url: location.href, title: document.title, text: lines.join("\n"), nodes };
}
