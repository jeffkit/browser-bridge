import { loadConfig, saveConfig } from "../common/config.js";

const urlInput = document.getElementById("gateway-url") as HTMLInputElement;
const tokenInput = document.getElementById("token") as HTMLInputElement;
const browserIdInput = document.getElementById("browser-id") as HTMLInputElement;
const saved = document.getElementById("saved")!;

void loadConfig().then((cfg) => {
  urlInput.value = cfg.gatewayUrl;
  tokenInput.value = cfg.token;
  browserIdInput.value = cfg.browserId;
});

document.getElementById("save")!.addEventListener("click", async () => {
  const browserId = browserIdInput.value.trim();
  if (browserId && !/^[A-Za-z0-9_-]{1,64}$/.test(browserId)) {
    saved.textContent = "浏览器 ID 仅限字母/数字/下划线/短横线（≤64 字符）";
    return;
  }
  await saveConfig({
    gatewayUrl: urlInput.value.trim(),
    token: tokenInput.value.trim(),
    browserId,
  });
  saved.textContent = "已保存，重连中…";
  setTimeout(() => (saved.textContent = ""), 2500);
});
