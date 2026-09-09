import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  bridgeError,
  DefaultTimeoutMs,
  ErrorCode,
  ErrorCodeHints,
  type MethodName,
} from "@browser-bridge/protocol";
import type { BrowserHub } from "../hub.js";
import { GATEWAY_VERSION } from "../config.js";

/** 工具的运行目标：共享 hub + 该 MCP 实例绑定的浏览器。 */
export interface ToolTarget {
  hub: BrowserHub;
  browserId: string;
}

const ToolResults = {
  image(base64: string, mimeType: string): CallToolResult {
    return { content: [{ type: "image", data: base64, mimeType }] };
  },
};

/** MCP 工具错误结果：错误码 + 提示语，帮助 agent 自行排查。 */
export function errorResult(err: unknown): CallToolResult {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? ErrorCode.Internal;
  const message = e?.message ?? String(err);
  const hint = ErrorCodeHints[code] ? `\n提示：${ErrorCodeHints[code]}` : "";
  return {
    content: [{ type: "text" as const, text: `错误 [${code}]：${message}${hint}` }],
    isError: true,
  };
}

/** 统一入口：检查目标浏览器在线 → 带默认超时调用。 */
async function call(target: ToolTarget, method: MethodName, params: unknown, timeoutMs?: number) {
  const session = target.hub.getSession(target.browserId);
  if (!session) {
    throw bridgeError(
      ErrorCode.BrowserDisconnected,
      `浏览器「${target.browserId}」未连接到 gateway（browser_status 可查看在线列表）`,
    );
  }
  return session.request(method, params, timeoutMs ?? DefaultTimeoutMs[method]);
}

const tabId = z.number().int().positive().describe("目标 tab id；缺省取当前活跃 tab");

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>, target: ToolTarget) => Promise<unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "browser_status",
    description:
      "查看浏览器连接状态：本工具绑定的浏览器是否在线、扩展名称/版本、gateway 版本、URL 允许列表、当前在线的全部浏览器（多浏览器/relay 场景用 browsers 字段）。其他 browser_* 工具报 browser_disconnected 时先用它排查。",
    schema: {},
    handler: async (_args, target) => {
      const s = target.hub.getSession(target.browserId);
      return {
        connected: s !== null,
        browserId: target.browserId,
        client: s?.client ?? null,
        gatewayVersion: GATEWAY_VERSION,
        allowUrlsEnabled: target.hub.allowUrlCount > 0,
        browsers: target.hub.listBrowsers(),
      };
    },
  },
  {
    name: "browser_tab_list",
    description: "列出浏览器所有标签页（id / 标题 / URL / 是否活跃）。",
    schema: {},
    handler: async (_args, target) => call(target, "tabs.list", {}),
  },
  {
    name: "browser_tab_open",
    description: "新开标签页并可指定 URL。受 gateway --allow-url 限制。",
    schema: {
      url: z.string().optional().describe("打开后导航到的 URL，缺省空白页"),
      active: z.boolean().optional().describe("是否立即激活，默认 true"),
    },
    handler: async (args, target) => {
      if (typeof args.url === "string") target.hub.requireUrlAllowed(args.url);
      return call(target, "tabs.create", args);
    },
  },
  {
    name: "browser_tab_close",
    description: "关闭指定标签页。",
    schema: { tabId: tabId.describe("要关闭的 tab id") },
    handler: async (args, target) => call(target, "tabs.close", args),
  },
  {
    name: "browser_tab_select",
    description: "激活（切换到）指定标签页。",
    schema: { tabId: tabId.describe("要激活的 tab id") },
    handler: async (args, target) => call(target, "tabs.activate", args),
  },
  {
    name: "browser_navigate",
    description:
      "在标签页中导航到 URL 并等待加载。受 gateway --allow-url 限制。waitFor 默认 load；超时返回 status:\"timeout\" 而非报错。",
    schema: {
      url: z.string().describe("目标 URL"),
      tabId: tabId.optional(),
      waitFor: z.enum(["load", "domcontentloaded", "none"]).optional(),
      timeoutMs: z.number().int().positive().max(120_000).optional(),
    },
    handler: async (args, target) => {
      target.hub.requireUrlAllowed(String(args.url));
      return call(target, "tabs.navigate", args);
    },
  },
  {
    name: "browser_snapshot",
    description:
      "获取页面可访问性快照：缩进文本骨架 + 可交互元素的 @eN 引用。操作页面前先调用它，用 @eN 引用点击/输入。页面跳转后旧引用失效，需重新快照。",
    schema: { tabId: tabId.optional() },
    handler: async (args, target) => call(target, "page.snapshot", args),
  },
  {
    name: "browser_click",
    description: "点击 @eN 引用的元素。",
    schema: { ref: z.string().describe("@eN 元素引用，来自 browser_snapshot"), tabId: tabId.optional() },
    handler: async (args, target) => call(target, "page.click", args),
  },
  {
    name: "browser_fill",
    description: "清空并填入 @eN 引用的输入框（触发 input/change 事件，兼容 React）。",
    schema: {
      ref: z.string().describe("@eN 元素引用"),
      value: z.string().describe("要填入的完整文本"),
      tabId: tabId.optional(),
    },
    handler: async (args, target) => call(target, "page.fill", args),
  },
  {
    name: "browser_type",
    description: "在 @eN 引用的元素内逐字符追加输入（不清空已有内容；清空请用 browser_fill）。",
    schema: {
      ref: z.string().describe("@eN 元素引用"),
      text: z.string().describe("要追加的文本"),
      tabId: tabId.optional(),
    },
    handler: async (args, target) => call(target, "page.type", args),
  },
  {
    name: "browser_press",
    description: '发送按键，如 Enter / Tab / Escape / ArrowDown / "Control+a"（修饰键用 + 连接）。',
    schema: {
      key: z.string().describe("按键名"),
      ref: z.string().optional().describe("@eN 元素引用；缺省发给当前焦点"),
      tabId: tabId.optional(),
    },
    handler: async (args, target) => call(target, "page.press", args),
  },
  {
    name: "browser_scroll",
    description: "滚动页面或指定元素（溢出容器）。",
    schema: {
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().positive().optional().describe("像素，默认 600"),
      ref: z.string().optional().describe("@eN 引用：滚动该元素自身"),
      tabId: tabId.optional(),
    },
    handler: async (args, target) => call(target, "page.scroll", args),
  },
  {
    name: "browser_evaluate",
    description:
      "在页面内执行 JS 函数（源码字符串），返回值需可 JSON 序列化。默认 ISOLATED 隔离世界；world:\"MAIN\" 可访问页面 window。受 --allow-url 限制的页面已按导航约束。",
    schema: {
      fn: z.string().describe('函数源码，如 "() => document.title"'),
      args: z.array(z.unknown()).optional().describe("传给函数的参数（可 JSON 序列化）"),
      world: z.enum(["ISOLATED", "MAIN"]).optional(),
      tabId: tabId.optional(),
    },
    handler: async (args, target) => call(target, "page.evaluate", args),
  },
  {
    name: "browser_screenshot",
    description:
      "截取标签页可见区域。返回 PNG（或指定 jpegQuality 时 JPEG）图片。非活跃 tab 会先激活再截图。",
    schema: { tabId: tabId.optional(), jpegQuality: z.number().int().min(0).max(100).optional() },
    handler: async (args, target) => {
      const r = (await call(target, "tabs.screenshot", args)) as { dataUrl?: string };
      const dataUrl = typeof r?.dataUrl === "string" ? r.dataUrl : "";
      const comma = dataUrl.indexOf(",");
      const meta = dataUrl.slice(5, comma); // image/png;base64
      const mimeType = meta.split(";")[0] ?? "image/png";
      return ToolResults.image(dataUrl.slice(comma + 1), mimeType);
    },
  },
];
