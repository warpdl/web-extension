import { BaseDetector } from "../../detector";
import type { OverlayOption, YtBridgeMessage } from "../../../types";

export class YouTubeDetector extends BaseDetector {
  private cachedOptions: OverlayOption[] = [];
  private messageHandler: ((ev: MessageEvent) => void) | null = null;

  protected shouldHandle(video: HTMLVideoElement): boolean {
    return video.id === "movie_player" || video.closest("#movie_player") !== null;
  }

  protected getOptions(_video: HTMLVideoElement): OverlayOption[] {
    return this.cachedOptions.slice();
  }

  protected onStart(): void {
    this.messageHandler = (ev: MessageEvent) => this.onMessage(ev);
    window.addEventListener("message", this.messageHandler);
    this.sendRequestFormats();
  }

  protected onStop(): void {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
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
