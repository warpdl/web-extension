import { describe, it, expect } from "vitest";
import { loadSettings, saveSettings } from "../../../src/settings";

describe("settings", () => {
  describe("loadSettings", () => {
    it("returns defaults when storage is empty", async () => {
      const s = await loadSettings();
      expect(s.daemonUrl).toBe("localhost:3850");
      expect(s.interceptDownloads).toBe(true);
    });

    it("merges stored values over defaults", async () => {
      await (globalThis as any).chrome.storage.sync.set({ settings: { daemonUrl: "myhost:9000" } });
      const s = await loadSettings();
      expect(s.daemonUrl).toBe("myhost:9000");
      expect(s.interceptDownloads).toBe(true); // default retained
    });
  });

  describe("saveSettings", () => {
    it("persists a partial update and returns the merged settings", async () => {
      const result = await saveSettings({ daemonUrl: "saved:1234" });
      expect(result.daemonUrl).toBe("saved:1234");
      expect(result.interceptDownloads).toBe(true);
    });

    it("preserves existing stored values when saving a partial update", async () => {
      await saveSettings({ daemonUrl: "first:1111" });
      const result = await saveSettings({ interceptDownloads: false });
      expect(result.daemonUrl).toBe("first:1111");
      expect(result.interceptDownloads).toBe(false);
    });
  });
});
