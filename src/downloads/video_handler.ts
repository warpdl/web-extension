import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import type { DaemonClient } from "../daemon/client";
import type { CapturedDownload, DaemonHeader, DaemonCookie } from "../types";
import { toDaemonCookie } from "../capture/cookie_mapper";
import { sanitizeFilename } from "../capture/sanitize_filename";
import { mapStateToReason } from "./send_or_fallback";

interface Deps {
  bus: EventBus;
  log: Logger;
  daemon: DaemonClient;
}

interface VideoMsg {
  type: "DOWNLOAD_VIDEO";
  url: string;
  fileName?: string;
  pageUrl?: string;
}

export interface VideoResponse {
  sent: boolean;
  fallback: boolean;
  error?: string;
}

export class VideoHandler {
  private log: Logger;
  private daemon: DaemonClient;
  private bus: EventBus;

  constructor(deps: Deps) {
    this.bus = deps.bus;
    this.log = deps.log.child("video");
    this.daemon = deps.daemon;
  }

  async handle(msg: VideoMsg): Promise<VideoResponse> {
    if (this.daemon.state !== "OPEN") {
      return this.fallback(msg, mapStateToReason(this.daemon.state));
    }

    const captured = await this.buildMessage(msg);
    const r = this.daemon.send(captured);
    if (r.ok) {
      this.bus.emit("send:outcome", { kind: "sent" });
      return { sent: true, fallback: false };
    }
    return this.fallback(msg, r.reason);
  }

  private async fallback(msg: VideoMsg, reason: string): Promise<VideoResponse> {
    try {
      await chrome.downloads.download({
        url: msg.url,
        filename: sanitizeFilename(msg.fileName ?? ""),
      });
      this.bus.emit("send:outcome", { kind: "fallback", reason });
      return { sent: false, fallback: true };
    } catch (e) {
      this.log.warn("fallback_download_failed", { url: msg.url, err: String(e) });
      this.bus.emit("send:outcome", { kind: "drop", reason: "download_api_failed" });
      return { sent: false, fallback: false, error: "download_api_failed" };
    }
  }

  private async buildMessage(msg: VideoMsg): Promise<CapturedDownload> {
    const headers: DaemonHeader[] = [];
    if (msg.pageUrl) headers.push({ key: "Referer", value: msg.pageUrl });

    let cookies: DaemonCookie[] = [];
    try {
      const raw = await chrome.cookies.getAll({ url: msg.url });
      cookies = raw.map(toDaemonCookie);
    } catch (e) {
      this.log.warn("cookies_get_failed", { url: msg.url, err: String(e) });
    }

    return { url: msg.url, headers, cookies };
  }
}
