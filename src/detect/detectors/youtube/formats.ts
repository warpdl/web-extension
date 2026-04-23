import { sanitizeFilename } from "../../../capture/sanitize_filename";
import { decodeFormatUrl, Decoders } from "./signature";
import type { PlayerResponse, YouTubeFormat } from "./player_data";
import type { OverlayOption } from "../../../types";

export function buildOptions(pr: PlayerResponse, decoders: Decoders): OverlayOption[] {
  const title = pr.videoDetails?.title ?? "video";
  const sd = pr.streamingData;
  if (!sd) return [];

  const out: OverlayOption[] = [];
  const combined = (sd.formats ?? []).slice().sort(byQualityDesc);
  const adaptiveVideo = (sd.adaptiveFormats ?? []).filter((f) => f.mimeType.startsWith("video/")).sort(byHeightDesc);
  const adaptiveAudio = (sd.adaptiveFormats ?? []).filter((f) => f.mimeType.startsWith("audio/")).sort(byAudioQualityDesc);

  for (const f of combined) pushOption(out, f, decoders, title, "Combined");
  for (const f of adaptiveVideo) pushOption(out, f, decoders, title, "Video only");
  for (const f of adaptiveAudio) pushOption(out, f, decoders, title, "Audio only");

  return out;
}

function pushOption(
  out: OverlayOption[],
  f: YouTubeFormat,
  decoders: Decoders,
  title: string,
  group: string
): void {
  const url = decodeFormatUrl(f, decoders);
  if (!url) return;
  const ext = extFromMime(f.mimeType);
  out.push({
    label: buildLabel(f),
    url,
    fileName: sanitizeFilename(title) + "." + ext,
    group,
  });
}

function buildLabel(f: YouTubeFormat): string {
  const parts: string[] = [];
  if (f.qualityLabel) parts.push(f.qualityLabel);
  else if (f.audioQuality) parts.push(f.audioQuality);
  parts.push(shortMime(f.mimeType));
  const size = formatSize(f.contentLength);
  if (size) parts.push(size);
  return parts.join(" · ");
}

function shortMime(mime: string): string {
  return mime.split(";")[0];
}

function extFromMime(mime: string): string {
  const base = mime.split(";")[0];
  const slash = base.indexOf("/");
  return slash >= 0 ? base.slice(slash + 1) : "bin";
}

function formatSize(contentLength: string | undefined): string {
  if (!contentLength) return "";
  const n = parseInt(contentLength, 10);
  if (!Number.isFinite(n)) return "";
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(1) + " GB";
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}

function parseQuality(q: string | undefined): number {
  if (!q) return 0;
  const m = q.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function byQualityDesc(a: YouTubeFormat, b: YouTubeFormat): number {
  return parseQuality(b.qualityLabel) - parseQuality(a.qualityLabel);
}

function byHeightDesc(a: YouTubeFormat, b: YouTubeFormat): number {
  return (b.height ?? 0) - (a.height ?? 0);
}

function byAudioQualityDesc(a: YouTubeFormat, b: YouTubeFormat): number {
  const rank = (q: string | undefined): number => {
    if (q === "AUDIO_QUALITY_HIGH") return 3;
    if (q === "AUDIO_QUALITY_MEDIUM") return 2;
    if (q === "AUDIO_QUALITY_LOW") return 1;
    return 0;
  };
  return rank(b.audioQuality) - rank(a.audioQuality);
}
