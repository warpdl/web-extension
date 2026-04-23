import { BaseDetector } from "../../detector";
import type { OverlayOption, ResolveUrlResult, ResolveYtUrlResponse } from "../../../types";

/**
 * YouTube detector.
 *
 * Architecture mirrors IDM: the extension is a thin shim. Instead of
 * reverse-engineering YouTube's base.js obfuscation in-extension, the
 * isolated-world content script asks the WarpDL daemon to resolve the
 * page URL via chrome.runtime.sendMessage({ type: "RESOLVE_YT_URL" }).
 * The background handler calls the daemon's resolve.url JSON-RPC which
 * shells out to yt-dlp server-side.
 *
 * Format options appear in the overlay dropdown as soon as the daemon
 * returns. If the daemon is unreachable or yt-dlp is missing, the
 * overlay shows a diagnostic error via console.warn.
 */
export class YouTubeDetector extends BaseDetector {
  private cachedOptions: OverlayOption[] = [];
  private lastResolvedUrl: string | null = null;
  private navListener: (() => void) | null = null;
  private detectorStopped = false;

  protected shouldHandle(video: HTMLVideoElement): boolean {
    return video.id === "movie_player" || video.closest("#movie_player") !== null;
  }

  protected getOptions(_video: HTMLVideoElement): OverlayOption[] {
    return this.cachedOptions.slice();
  }

  protected onStart(): void {
    this.detectorStopped = false;
    void this.kickOffResolve();

    // Re-resolve when YouTube's SPA navigation completes.
    this.navListener = () => {
      // Small debounce — YouTube fires navigate-finish before the new
      // ytInitialPlayerResponse is visible in-page; waiting briefly
      // lets the URL change settle before we send it to the daemon.
      setTimeout(() => {
        if (!this.detectorStopped) void this.kickOffResolve();
      }, 500);
    };
    document.addEventListener("yt-navigate-finish", this.navListener);
  }

  protected onStop(): void {
    this.detectorStopped = true;
    if (this.navListener) {
      document.removeEventListener("yt-navigate-finish", this.navListener);
      this.navListener = null;
    }
  }

  private async kickOffResolve(): Promise<void> {
    if (this.detectorStopped) return;
    const pageUrl = location.href;
    if (pageUrl === this.lastResolvedUrl) return;
    this.lastResolvedUrl = pageUrl;

    let resp: ResolveYtUrlResponse | undefined;
    try {
      resp = await chrome.runtime.sendMessage<unknown, ResolveYtUrlResponse>({
        type: "RESOLVE_YT_URL",
        pageUrl,
      });
    } catch (e) {
      if (this.detectorStopped) return;
      console.warn("[WarpDL YT] RESOLVE_YT_URL failed:", e);
      return;
    }

    if (this.detectorStopped) return;

    if (!resp || !resp.ok) {
      console.warn(
        "[WarpDL YT] resolve failed:",
        resp?.ok === false ? resp.error : "no response",
        "code:",
        resp?.ok === false ? resp.code : undefined,
      );
      this.cachedOptions = [];
      for (const video of this.handles.keys()) void this.refresh(video);
      return;
    }

    this.cachedOptions = this.buildOptions(resp.result);
    for (const video of this.handles.keys()) void this.refresh(video);
  }

  private buildOptions(result: ResolveUrlResult): OverlayOption[] {
    const title = result.title || "video";
    const options: OverlayOption[] = [];

    // Three groups matching yt-dlp's stream shapes:
    // - Combined: has both video + audio in one stream (legacy 18/22/etc.)
    // - Video only: adaptive video-only streams (137, 299, ...)
    // - Audio only: adaptive audio-only streams (140, 251, ...)
    const combined = result.formats
      .filter((f) => f.hasVideo && f.hasAudio)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    const videoOnly = result.formats
      .filter((f) => f.hasVideo && !f.hasAudio)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    const audioOnly = result.formats
      .filter((f) => !f.hasVideo && f.hasAudio)
      .sort((a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0));

    for (const f of combined) options.push(toOption(f, title, "Combined"));
    for (const f of videoOnly) options.push(toOption(f, title, "Video only"));
    for (const f of audioOnly) options.push(toOption(f, title, "Audio only"));

    return options;
  }
}

function toOption(f: { formatId: string; url: string; ext: string; quality?: string; fileSize?: number; height?: number; videoCodec?: string; audioCodec?: string; audioBitrate?: number }, title: string, group: string): OverlayOption {
  const labelParts: string[] = [];
  if (f.quality) labelParts.push(f.quality);
  else if (f.height) labelParts.push(`${f.height}p`);
  else if (f.audioBitrate) labelParts.push(`${f.audioBitrate} kbps`);

  labelParts.push(f.ext);
  if (f.fileSize) labelParts.push(formatBytes(f.fileSize));

  return {
    label: labelParts.join(" · "),
    url: f.url,
    fileName: `${sanitize(title)}.${f.ext}`,
    group,
  };
}

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(0, 200) || "video";
}
