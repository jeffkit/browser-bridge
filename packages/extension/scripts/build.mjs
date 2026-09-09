import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const target = "chrome116";

/**
 * Chromium（dist-extension/）：MV3 service worker，ESM。
 * Firefox（dist-extension-firefox/）：MV3 事件页不支持 service_worker/type:module，
 * 打成 IIFE 后用 background.scripts 加载；API 走 src/common/api.ts 的 browser.* 适配。
 */
function bundle({ outfile, entryPoint, format }) {
  return build({
    entryPoints: [entryPoint],
    bundle: true,
    outfile,
    format,
    target,
  });
}

const chromiumOut = "dist-extension";
const firefoxOut = "dist-extension-firefox";
rmSync(chromiumOut, { recursive: true, force: true });
rmSync(firefoxOut, { recursive: true, force: true });
mkdirSync(chromiumOut, { recursive: true });
mkdirSync(firefoxOut, { recursive: true });

// ---- Chromium ----
await bundle({
  entryPoint: "src/service-worker/index.ts",
  outfile: `${chromiumOut}/service-worker.js`,
  format: "esm",
});
for (const [entry, out] of [
  ["src/content/index.ts", "content.js"],
  ["src/popup/popup.ts", "popup.js"],
  ["src/options/options.ts", "options.js"],
]) {
  await bundle({ entryPoint: entry, outfile: `${chromiumOut}/${out}`, format: "iife" });
}
cpSync("manifest.json", `${chromiumOut}/manifest.json`);

// ---- Firefox ----
await bundle({
  entryPoint: "src/service-worker/index.ts",
  outfile: `${firefoxOut}/service-worker.js`,
  format: "iife",
});
for (const [entry, out] of [
  ["src/content/index.ts", "content.js"],
  ["src/popup/popup.ts", "popup.js"],
  ["src/options/options.ts", "options.js"],
]) {
  await bundle({ entryPoint: entry, outfile: `${firefoxOut}/${out}`, format: "iife" });
}
cpSync("manifest.firefox.json", `${firefoxOut}/manifest.json`);

for (const dir of [chromiumOut, firefoxOut]) {
  cpSync("src/popup/popup.html", `${dir}/popup.html`);
  cpSync("src/options/options.html", `${dir}/options.html`);
}

console.log(`extension → ${chromiumOut}/ (Chromium), ${firefoxOut}/ (Firefox)`);
