"use strict";
(() => {
  // src/common/api.ts
  var impl = globalThis.browser ?? globalThis.chrome;
  var api = impl;

  // src/popup/popup.ts
  var label = {
    connected: "\u5DF2\u8FDE\u63A5 gateway",
    connecting: "\u8FDE\u63A5\u4E2D\u2026",
    disconnected: "\u672A\u8FDE\u63A5",
    error: "\u8FDE\u63A5\u51FA\u9519"
  };
  async function render() {
    const status = document.getElementById("status");
    const dot = document.getElementById("dot");
    const error = document.getElementById("error");
    let resp = null;
    try {
      resp = await api.runtime.sendMessage({ type: "bb-status" });
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
    }
    if (!resp) {
      status.textContent = label.disconnected;
      dot.className = "dot";
      return;
    }
    status.textContent = label[resp.status] ?? resp.status;
    dot.className = `dot ${resp.status}`;
    error.textContent = resp.status === "connected" ? "" : resp.lastError ?? "";
  }
  document.getElementById("open-options").addEventListener("click", () => {
    void api.runtime.openOptionsPage();
  });
  void render();
})();
