import { ExtensionSettings } from "./types";

const DEFAULTS: ExtensionSettings = {
  daemonUrl: "localhost:3850",
  interceptDownloads: true,
};

const STORAGE_KEY = "settings";

export async function loadSettings(): Promise<ExtensionSettings> {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  return { ...DEFAULTS, ...(data[STORAGE_KEY] ?? {}) };
}

export async function saveSettings(
  settings: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.sync.set({ [STORAGE_KEY]: merged });
  return merged;
}

export function onSettingsChanged(
  cb: (settings: ExtensionSettings) => void
): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      const newVal = changes[STORAGE_KEY].newValue as ExtensionSettings;
      cb({ ...DEFAULTS, ...newVal });
    }
  });
}
