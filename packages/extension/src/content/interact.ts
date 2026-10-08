import { parseRef } from "@browser-bridge/protocol";

/**
 * @s<gen>:e<N> 引用解析。
 * 三重失效检查，任一不过即抛 stale_ref（fail-closed，绝不落到同序号的新元素上）：
 * - ref 形状：必须是带代次的新格式（旧式 @eN / 乱串直接拒）；
 * - 代次：必须等于当前快照代次——新 snapshot 一旦发生，旧 ref 全部失效；
 * - 连接：元素必须仍在文档中（页面跳转/刷新后缓存随注入重建而清空）。
 */
export function resolveElement(refs: Map<string, Element>, gen: number, ref: string): Element {
  const parsed = parseRef(ref);
  if (!parsed || parsed.gen !== gen || parsed.index < 1) {
    throw staleRef(ref, `引用 ${ref} 不是本页面当前快照（代次 ${gen}）的元素，请重新 snapshot`);
  }
  const el = refs.get(ref);
  if (!el || !el.isConnected) {
    throw staleRef(ref, `元素引用 ${ref} 已失效（页面跳转或刷新后需重新 snapshot）`);
  }
  return el;
}

function staleRef(ref: string, message: string): Error {
  return Object.assign(new Error(message), { code: "stale_ref", ref });
}

function focusEl(el: Element): void {
  el.scrollIntoView({ block: "center", inline: "center" });
  if (typeof (el as HTMLElement).focus === "function") {
    (el as HTMLElement).focus();
  }
}

function setValueAndEvents(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // React 受控组件重写 value：必须走原型 setter 再派发 input
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function doClick(refs: Map<string, Element>, gen: number, ref: string): unknown {
  const el = resolveElement(refs, gen, ref);
  focusEl(el);
  (el as HTMLElement).click();
  return { clicked: true, ref };
}

export function doFill(refs: Map<string, Element>, gen: number, ref: string, value: string): unknown {
  const el = resolveElement(refs, gen, ref);
  focusEl(el);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setValueAndEvents(el, value);
  } else if (el instanceof HTMLSelectElement) {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if ((el as HTMLElement).isContentEditable) {
    const target = el as HTMLElement;
    target.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, value);
  } else {
    const generic = el as HTMLInputElement;
    generic.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { filled: true, ref };
}

export function doType(refs: Map<string, Element>, gen: number, ref: string, text: string): unknown {
  const el = resolveElement(refs, gen, ref);
  focusEl(el);
  if ((el as HTMLElement).isContentEditable) {
    document.execCommand("insertText", false, text);
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // 逐字符追加，保持 input 事件频率接近真实键入
    for (const ch of text) {
      setValueAndEvents(el, el.value + ch);
    }
  } else {
    throw Object.assign(new Error(`元素 ${ref} 不是可输入元素`), { code: "page_action_failed" });
  }
  return { typed: true, ref };
}

export interface ParsedKey {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export function parseKey(spec: string): ParsedKey {
  const parts = spec.split("+").map((s) => s.trim());
  const key = parts.pop() ?? spec;
  const lower = parts.map((p) => p.toLowerCase());
  return {
    key,
    ctrlKey: lower.includes("control") || lower.includes("ctrl"),
    shiftKey: lower.includes("shift"),
    altKey: lower.includes("alt") || lower.includes("option"),
    metaKey: lower.includes("meta") || lower.includes("command") || lower.includes("cmd"),
  };
}

export function doPress(refs: Map<string, Element>, gen: number, keySpec: string, ref?: string): unknown {
  const target = ref ? resolveElement(refs, gen, ref) : document.activeElement ?? document.body;
  if (ref) focusEl(target);
  const parsed = parseKey(keySpec);
  const init: KeyboardEventInit = {
    ...parsed,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  return { pressed: true };
}

export function doScroll(
  refs: Map<string, Element>,
  gen: number,
  direction: "up" | "down" | "left" | "right",
  amount: number,
  ref?: string,
): unknown {
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
