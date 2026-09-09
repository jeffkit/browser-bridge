/**
 * 打包浏览器扩展发布物（zip，包内为扩展根目录文件）：
 *   dist-release/browser-bridge-extension-chromium-v<version>.zip  → 解压后「加载已解压的扩展程序」
 *   dist-release/browser-bridge-extension-firefox-v<version>.zip   → 解压后 about:debugging 临时载入
 *
 * 前置：pnpm build。运行：node scripts/package.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const version = JSON.parse(
  readFileSync(path.join(root, "packages/extension/manifest.json"), "utf8"),
).version;
const outDir = path.join(root, "dist-release");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const targets = [
  ["dist-extension", "chromium"],
  ["dist-extension-firefox", "firefox"],
];
for (const [dir, name] of targets) {
  const zip = path.join(outDir, `browser-bridge-extension-${name}-v${version}.zip`);
  execSync(`zip -qr "${zip}" .`, {
    cwd: path.join(root, "packages/extension", dir),
    stdio: "inherit",
  });
  console.log(`✓ ${path.relative(root, zip)}`);
}
