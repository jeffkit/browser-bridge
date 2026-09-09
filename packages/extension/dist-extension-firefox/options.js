"use strict";
(() => {
  // src/common/api.ts
  var impl = globalThis.browser ?? globalThis.chrome;
  var api = impl;

  // src/common/config.ts
  var STORAGE_KEY = "config";
  async function loadConfig() {
    const obj = await api.storage.local.get(STORAGE_KEY);
    const cfg = obj[STORAGE_KEY] ?? {};
    return {
      gatewayUrl: cfg.gatewayUrl ?? "",
      token: cfg.token ?? "",
      browserId: cfg.browserId ?? ""
    };
  }
  async function saveConfig(cfg) {
    await api.storage.local.set({ [STORAGE_KEY]: cfg });
  }

  // src/options/options.ts
  var urlInput = document.getElementById("gateway-url");
  var tokenInput = document.getElementById("token");
  var browserIdInput = document.getElementById("browser-id");
  var saved = document.getElementById("saved");
  void loadConfig().then((cfg) => {
    urlInput.value = cfg.gatewayUrl;
    tokenInput.value = cfg.token;
    browserIdInput.value = cfg.browserId;
  });
  document.getElementById("save").addEventListener("click", async () => {
    const browserId = browserIdInput.value.trim();
    if (browserId && !/^[A-Za-z0-9_-]{1,64}$/.test(browserId)) {
      saved.textContent = "\u6D4F\u89C8\u5668 ID \u4EC5\u9650\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u77ED\u6A2A\u7EBF\uFF08\u226464 \u5B57\u7B26\uFF09";
      return;
    }
    await saveConfig({
      gatewayUrl: urlInput.value.trim(),
      token: tokenInput.value.trim(),
      browserId
    });
    saved.textContent = "\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u8FDE\u4E2D\u2026";
    setTimeout(() => saved.textContent = "", 2500);
  });
})();
