import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const outdir = "dist-extension";
const target = "chrome116";
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: ["src/service-worker/index.ts"],
  bundle: true,
  outfile: `${outdir}/service-worker.js`,
  format: "esm",
  target,
  platform: "browser",
});

await build({
  entryPoints: ["src/content/index.ts"],
  bundle: true,
  outfile: `${outdir}/content.js`,
  format: "iife",
  target,
});

await build({
  entryPoints: ["src/popup/popup.ts"],
  bundle: true,
  outfile: `${outdir}/popup.js`,
  format: "iife",
  target,
});

await build({
  entryPoints: ["src/options/options.ts"],
  bundle: true,
  outfile: `${outdir}/options.js`,
  format: "iife",
  target,
});

cpSync("manifest.json", `${outdir}/manifest.json`);
cpSync("src/popup/popup.html", `${outdir}/popup.html`);
cpSync("src/options/options.html", `${outdir}/options.html`);

console.log(`extension → ${outdir}/`);
