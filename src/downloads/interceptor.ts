import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import type { DaemonClient } from "../daemon/client";
import type { HeaderStore } from "../capture/header_store";
import type { CapturedDownload, DaemonHeader, DaemonCookie, ExtensionSettings } from "../types";
import { toDaemonCookie } from "../capture/cookie_mapper";

interface Deps {
  bus: EventBus;
  log: Logger;
  daemon: DaemonClient;
  headerStore: HeaderStore;
  getSettings: () => ExtensionSettings;
}

interface DownloadItem {
  id: number;
  url: string;
  finalUrl?: string;
}

export class DownloadInterceptor {
  private log: Logger;
  private daemon: DaemonClient;
  private headerStore: HeaderStore;
  private getSettings: () => ExtensionSettings;
  private bus: EventBus;

  constructor(deps: Deps) {
    this.bus = deps.bus;
    this.log = deps.log.child("interceptor");
    this.daemon = deps.daemon;
    this.headerStore = deps.headerStore;
    this.getSettings = deps.getSettings;
  }

  async handle(item: DownloadItem): Promise<void> {
    const settings = this.getSettings();
    if (!settings.interceptDownloads) {
      this.log.debug("skip_intercept_disabled", { url: item.url });
      return;
    }

    const url = item.finalUrl || item.url;
    if (!/^https?:\/\//i.test(url)) {
      this.log.debug("skip_non_http", { url });
      return;
    }

    if (this.daemon.state !== "OPEN") {
      this.log.info("skip_daemon_not_open", { url, state: this.daemon.state });
      this.bus.emit("send:outcome", { kind: "fallback", reason: this.daemon.state });
      return;   // browser continues
    }

    const msg = await this.buildMessage(url);
    const result = this.daemon.send(msg);
    this.headerStore.delete(url);

    if (!result.ok) {
      this.log.warn("send_failed_no_cancel", { url, reason: result.reason });
      this.bus.emit("send:outcome", { kind: "fallback", reason: result.reason });
      return;   // browser keeps downloading
    }

    this.bus.emit("send:outcome", { kind: "sent" });
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch (e) {
      this.log.warn("cancel_or_erase_failed", { id: item.id, err: String(e) });
    }
  }

  private async buildMessage(url: string): Promise<CapturedDownload> {
    const headers: DaemonHeader[] = [];
    const stored = this.headerStore.get(url);
    if (stored) {
      for (const h of stored) {
        if (h.value === undefined) continue;
        if (h.name.toLowerCase() === "cookie") continue;
        headers.push({ key: h.name, value: h.value });
      }
    }

    let cookies: DaemonCookie[] = [];
    try {
      const raw = await chrome.cookies.getAll({ url });
      cookies = raw.map(toDaemonCookie);
    } catch (e) {
      this.log.warn("cookies_get_failed", { url, err: String(e) });
    }

    return { url, headers, cookies };
  }
}
