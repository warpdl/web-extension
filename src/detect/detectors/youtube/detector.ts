import { BaseDetector } from "../../detector";
import type { OverlayOption, ResolveUrlResult, ResolvedFormat, ResolveYtUrlResponse } from "../../../types";

/**
 * YouTube detector.
 *
 * Architecture mirrors IDM: the extension is a thin shim. The isolated-world
 * content script asks the WarpDL daemon to resolve the page URL via
 * chrome.runtime.sendMessage({ type: "RESOLVE_YT_URL" }). The background
 * handler calls the daemon's resolve.url JSON-RPC, which uses
 * github.com/kkdai/youtube/v2 to extract format metadata.
 *
 * The overlay dropdown lists three groups, all using the same daemon-mediated
 * download path:
 *   - Combined: progressive itags (audio+video bundled). Single download.
 *   - Video (HD): adaptive video-only itags paired with the best matching
 *     audio leg. Daemon downloads both and runs ffmpeg to remux.
 *   - Audio: adaptive audio-only itags. Single download, no mux.
 *
 * When the user clicks an option, the click handler emits DOWNLOAD_YT_VIDEO
 * with the videoId + chosen itags; the daemon's youtube.download RPC handles
 * the rest (URL signature decode, segmented download, mux).
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

    this.navListener = () => {
      // YouTube fires navigate-finish before the new page state settles.
      // Brief debounce avoids re-resolving the previous URL.
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
    const videoId = result.videoId ?? "";
    if (!videoId) {
      console.warn("[WarpDL YT] resolve.url returned no videoId; download disabled");
      return [];
    }

    const title = result.title || "video";
    const options: OverlayOption[] = [];

    const combined = result.formats
      .filter((f) => f.hasVideo && f.hasAudio)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    const videoOnly = result.formats
      .filter((f) => f.hasVideo && !f.hasAudio)
      .sort((a, b) => {
        const dh = (b.height ?? 0) - (a.height ?? 0);
        if (dh !== 0) return dh;
        return (b.fps ?? 0) - (a.fps ?? 0);
      });

    const audioOnly = result.formats
      .filter((f) => !f.hasVideo && f.hasAudio)
      .sort((a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0));

    for (const f of combined) {
      options.push({
        label: formatLabel(f),
        sublabel: codecSublabel(f),
        url: "", // daemon will resolve at download time
        fileName: `${sanitize(title)}.${f.ext}`,
        group: "Combined",
        daemonRequest: { videoId, videoFormatId: f.formatId },
      });
    }

    // Pair each video-only format with a sensible audio companion. We pick
    // the first audio leg whose container family matches (mp4/m4a or webm/
    // opus), falling back to the highest-bitrate audio when no match.
    for (const v of videoOnly) {
      const audio = pickAudioCompanion(v, audioOnly);
      if (!audio) continue;
      options.push({
        label: formatLabel(v) + " (HD)",
        sublabel: muxSublabel(v, audio),
        url: "",
        fileName: `${sanitize(title)}.${pickContainerExt(v.ext, audio.ext)}`,
        group: "Video (mux)",
        daemonRequest: {
          videoId,
          videoFormatId: v.formatId,
          audioFormatId: audio.formatId,
        },
      });
    }

    for (const f of audioOnly) {
      options.push({
        label: audioLabel(f),
        sublabel: codecSublabel(f),
        url: "",
        fileName: `${sanitize(title)}.${f.ext}`,
        group: "Audio",
        daemonRequest: { videoId, videoFormatId: f.formatId },
      });
    }

    return options;
  }
}

function formatLabel(f: ResolvedFormat): string {
  const parts: string[] = [];
  if (f.quality) parts.push(f.quality);
  else if (f.height) parts.push(`${f.height}p`);
  parts.push(f.ext);
  if (f.fileSize) parts.push(formatBytes(f.fileSize));
  return parts.join(" · ");
}

function audioLabel(f: ResolvedFormat): string {
  const parts: string[] = [];
  if (f.audioBitrate) parts.push(`${f.audioBitrate} kbps`);
  else if (f.quality) parts.push(f.quality);
  parts.push(f.ext);
  if (f.fileSize) parts.push(formatBytes(f.fileSize));
  return parts.join(" · ");
}

function codecSublabel(f: ResolvedFormat): string | undefined {
  const codecs: string[] = [];
  if (f.videoCodec) codecs.push(f.videoCodec);
  if (f.audioCodec) codecs.push(f.audioCodec);
  return codecs.length ? codecs.join(" + ") : undefined;
}

function muxSublabel(v: ResolvedFormat, a: ResolvedFormat): string {
  const total = (v.fileSize ?? 0) + (a.fileSize ?? 0);
  const codecs = [v.videoCodec, a.audioCodec].filter(Boolean).join(" + ");
  const parts = [codecs, total ? formatBytes(total) : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "video + audio mux";
}

// pickAudioCompanion picks an audio leg suitable for muxing with the given
// video leg. Strategy:
//   1) Prefer matching container family (mp4 video → m4a/mp4 audio,
//      webm video → webm/opus audio).
//   2) Among matches, prefer higher audio bitrate.
//   3) If no match, fall back to the first (highest-bitrate) audio overall.
function pickAudioCompanion(video: ResolvedFormat, audios: ResolvedFormat[]): ResolvedFormat | null {
  if (audios.length === 0) return null;
  const family = containerFamily(video.ext);
  const matched = audios.filter((a) => containerFamily(a.ext) === family);
  if (matched.length > 0) return matched[0];
  return audios[0];
}

function containerFamily(ext: string): "mp4" | "webm" | "other" {
  const e = ext.toLowerCase();
  if (e === "mp4" || e === "m4a") return "mp4";
  if (e === "webm" || e === "opus") return "webm";
  return "other";
}

function pickContainerExt(videoExt: string, audioExt: string): string {
  const f = containerFamily(videoExt);
  if (f === "mp4") return "mp4";
  if (f === "webm" && containerFamily(audioExt) === "webm") return "webm";
  return "mkv";
  // Mirrors daemon's pickContainer; the daemon picks the actual container
  // server-side, this is just for the suggested filename.
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
