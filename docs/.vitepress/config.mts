import { defineConfig } from "vitepress";

// GitHub Pages 项目站：https://jeffkit.github.io/browser-bridge/
export default defineConfig({
  lang: "zh-CN",
  title: "browser-bridge",
  description: "远程 Agent ↔ 本地浏览器桥：Chrome/Edge MV3 扩展 + MCP gateway",
  base: "/browser-bridge/",
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/browser-bridge/logo.svg" }]],
  themeConfig: {
    siteTitle: "browser-bridge",
    nav: [
      { text: "指南", link: "/guide/introduction", activeMatch: "/guide/" },
      { text: "参考", link: "/reference/tools", activeMatch: "/reference/" },
      { text: "FAQ", link: "/reference/faq" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "指南",
          items: [
            { text: "介绍", link: "/guide/introduction" },
            { text: "安装", link: "/guide/install" },
            { text: "配置", link: "/guide/configure" },
            { text: "公网中转（Relay）", link: "/guide/relay" },
            { text: "使用", link: "/guide/usage" },
            { text: "安全", link: "/guide/security" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "参考",
          items: [
            { text: "MCP 工具", link: "/reference/tools" },
            { text: "错误码", link: "/reference/errors" },
            { text: "线协议", link: "/reference/protocol" },
            { text: "FAQ / 故障排查", link: "/reference/faq" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/jeffkit/browser-bridge" }],
    search: { provider: "local", options: { translations: { button: { buttonText: "搜索" } } } },
    outline: { level: [2, 3], label: "本页目录" },
    docFooter: { prev: "上一页", next: "下一页" },
    lastUpdated: { text: "最后更新" },
    returnToTopLabel: "回到顶部",
    sidebarMenuLabel: "菜单",
  },
});
