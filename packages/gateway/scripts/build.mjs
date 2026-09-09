import { build } from "esbuild";

/**
 * 打包 CLI 为单文件 ESM（entry 的 shebang 会被保留到输出顶部）。
 * @browser-bridge/protocol 打进 bundle，npm 包对其零依赖（不发布该内部包）；
 * 真实运行时依赖保持 external，由 npm 安装。
 */
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.js",
  external: ["ws", "@modelcontextprotocol/sdk", "commander", "zod"],
  sourcemap: false,
  logLevel: "info",
});
