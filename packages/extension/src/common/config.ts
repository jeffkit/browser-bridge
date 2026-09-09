/** 扩展配置：存 chrome.storage.local，options 页维护。 */
export interface ExtConfig {
  /** gateway 地址，如 ws://192.168.1.5:17833 或 wss://bridge.example.com */
  gatewayUrl: string;
  /** pairing token，与 gateway --token 一致 */
  token: string;
}

const STORAGE_KEY = "config";

export async function loadConfig(): Promise<ExtConfig> {
  const obj = await chrome.storage.local.get(STORAGE_KEY);
  const cfg = (obj[STORAGE_KEY] ?? {}) as Partial<ExtConfig>;
  return { gatewayUrl: cfg.gatewayUrl ?? "", token: cfg.token ?? "" };
}

export async function saveConfig(cfg: ExtConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
}

/** 配置变更通知（options 保存后 SW 立即重连）。 */
export function onConfigChanged(cb: (cfg: ExtConfig) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      const cfg = changes[STORAGE_KEY].newValue as Partial<ExtConfig> | undefined;
      cb({ gatewayUrl: cfg?.gatewayUrl ?? "", token: cfg?.token ?? "" });
    }
  });
}
