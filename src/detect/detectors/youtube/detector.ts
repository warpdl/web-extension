import { BaseDetector } from "../../detector";
import type { OverlayOption, YtBridgeMessage } from "../../../types";

export class YouTubeDetector extends BaseDetector {
  private cachedOptions: OverlayOption[] = [];
  private messageHandler: ((ev: MessageEvent) => void) | null = null;
  private chromeMessageHandler: ((msg: unknown) => void) | null = null;

  protected shouldHandle(video: HTMLVideoElement): boolean {
    return video.id === "movie_player" || video.closest("#movie_player") !== null;
  }

  protected getOptions(_video: HTMLVideoElement): OverlayOption[] {
    return this.cachedOptions.slice();
  }

  protected onStart(): void {
    this.messageHandler = (ev: MessageEvent) => this.onMessage(ev);
    window.addEventListener("message", this.messageHandler);

    // Listen for YT_URL_CAPTURED events from the background (webRequest listener)
    // and forward them to the main world so the URL sniffer can cache them.
    this.chromeMessageHandler = (msg: unknown) => this.onChromeMessage(msg);
    try {
      chrome.runtime.onMessage.addListener(this.chromeMessageHandler as (m: unknown) => boolean);
    } catch { /* chrome.runtime unavailable in test */ }

    // Request any URLs already captured before this content script loaded.
    try {
      chrome.runtime.sendMessage({ type: "GET_YT_CAPTURED_URLS" }, (resp?: { items?: Array<{ itag: number; url: string }> }) => {
        if (!resp?.items) return;
        for (const { itag, url } of resp.items) {
          this.forwardCapturedUrlToMainWorld(itag, url);
        }
      });
    } catch { /* ignore */ }

    this.sendRequestFormats();
  }

  protected onStop(): void {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    if (this.chromeMessageHandler) {
      try { chrome.runtime.onMessage.removeListener(this.chromeMessageHandler as (m: unknown) => boolean); } catch {/* */}
      this.chromeMessageHandler = null;
    }
  }

  private onChromeMessage(msg: unknown): void {
    const m = msg as { type?: string; itag?: number; url?: string } | null;
    if (m?.type !== "YT_URL_CAPTURED") return;
    if (typeof m.itag !== "number" || typeof m.url !== "string") return;
    this.forwardCapturedUrlToMainWorld(m.itag, m.url);
  }

  private forwardCapturedUrlToMainWorld(itag: number, url: string): void {
    // Post a namespaced message the main_world sniffer will pick up.
    window.postMessage({
      source: "warpdl-yt-content",
      type: "yt-url-captured",
      itag,
      url,
    }, "*");
  }

  private sendRequestFormats(): void {
    const msg: YtBridgeMessage = { source: "warpdl-yt-content", type: "request-formats" };
    window.postMessage(msg, "*");
  }

  private onMessage(ev: MessageEvent): void {
    // ev.source is null in jsdom when the message originates from the same window
    if (ev.source !== null && ev.source !== window) return;
    const data = ev.data as YtBridgeMessage | null;
    if (!data || data.source !== "warpdl-yt-main") return;

    if (data.type === "formats-ready") {
      this.cachedOptions = data.options;
      for (const video of this.handles.keys()) {
        void this.refresh(video);
      }
    } else if (data.type === "formats-error") {
      this.cachedOptions = [];
      for (const video of this.handles.keys()) {
        void this.refresh(video);
      }
      console.warn("[WarpDL YT]", "formats-error", data.reason);
    }
  }
}
