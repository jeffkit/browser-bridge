const label: Record<string, string> = {
  connected: "已连接 gateway",
  connecting: "连接中…",
  disconnected: "未连接",
  error: "连接出错",
};

function render(): void {
  chrome.runtime.sendMessage({ type: "bb-status" }, (resp) => {
    const status = document.getElementById("status")!;
    const dot = document.getElementById("dot")!;
    const error = document.getElementById("error")!;
    if (chrome.runtime.lastError || !resp) {
      status.textContent = label.disconnected;
      dot.className = "dot";
      error.textContent = chrome.runtime.lastError?.message ?? "";
      return;
    }
    status.textContent = label[resp.status as string] ?? String(resp.status);
    dot.className = `dot ${resp.status}`;
    error.textContent = resp.status === "connected" ? "" : (resp.lastError ?? "");
  });
}

document.getElementById("open-options")!.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

render();
