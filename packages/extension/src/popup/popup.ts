import { api } from "../common/api.js";

const label: Record<string, string> = {
  connected: "已连接 gateway",
  connecting: "连接中…",
  disconnected: "未连接",
  error: "连接出错",
};

interface StatusResponse {
  status: string;
  lastError?: string;
}

async function render(): Promise<void> {
  const status = document.getElementById("status")!;
  const dot = document.getElementById("dot")!;
  const error = document.getElementById("error")!;
  let resp: StatusResponse | null = null;
  try {
    resp = (await api.runtime.sendMessage({ type: "bb-status" })) as StatusResponse | null;
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
  error.textContent = resp.status === "connected" ? "" : (resp.lastError ?? "");
}

document.getElementById("open-options")!.addEventListener("click", () => {
  void api.runtime.openOptionsPage();
});

void render();
