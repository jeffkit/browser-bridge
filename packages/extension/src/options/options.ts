import { loadConfig, saveConfig } from "../common/config.js";

const urlInput = document.getElementById("gateway-url") as HTMLInputElement;
const tokenInput = document.getElementById("token") as HTMLInputElement;
const saved = document.getElementById("saved")!;

void loadConfig().then((cfg) => {
  urlInput.value = cfg.gatewayUrl;
  tokenInput.value = cfg.token;
});

document.getElementById("save")!.addEventListener("click", async () => {
  await saveConfig({ gatewayUrl: urlInput.value.trim(), token: tokenInput.value.trim() });
  saved.textContent = "已保存，重连中…";
  setTimeout(() => (saved.textContent = ""), 2500);
});
