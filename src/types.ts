// ── Daemon types (matches Go structs in warpdl) ──

// Matches warplib.Header: json tags are lowercase "key" / "value"
export interface DaemonHeader {
  key: string;
  value: string;
}

// Matches Go's net/http.Cookie struct (field names are PascalCase, no json tags)
export interface DaemonCookie {
  Name: string;
  Value: string;
  Path?: string;
  Domain?: string;
  Expires?: string;
  MaxAge?: number;
  Secure?: boolean;
  HttpOnly?: boolean;
  SameSite?: number; // Go's http.SameSite is an int: 0=default, 1=lax, 2=strict, 3=none
}

// The message format the daemon's root WebSocket expects (capturedDownload struct)
export interface CapturedDownload {
  url: string;
  headers: DaemonHeader[];
  cookies: DaemonCookie[];
}

// ── Extension settings ──

export interface ExtensionSettings {
  daemonUrl: string; // e.g. "localhost:3850"
  interceptDownloads: boolean;
}

// ── Daemon resolve.url RPC ──

export interface ResolvedFormat {
  formatId: string;
  url: string;
  ext: string;
  mimeType?: string;
  quality?: string;
  fileSize?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  height?: number;
  width?: number;
  fps?: number;
  audioBitrate?: number;
}

export interface ResolveUrlResult {
  videoId?: string;
  title: string;
  author?: string;
  duration?: number;
  formats: ResolvedFormat[];
}

// ── Daemon youtube.download RPC ──

export interface YouTubeDownloadParams {
  videoId: string;
  videoFormatId: string;
  audioFormatId?: string;
  dir?: string;
  fileName?: string;
  connections?: number;
}

export interface YouTubeDownloadResult {
  gid: string;
  muxed: boolean;
  fileName: string;
}

// ── Internal messaging (content script / popup <-> service worker) ──

export type ExtensionMessage =
  | { type: "DOWNLOAD_VIDEO"; url: string; fileName?: string; pageUrl?: string }
  | { type: "DOWNLOAD_YT_VIDEO"; videoId: string; videoFormatId: string; audioFormatId?: string; fileName?: string }
  | { type: "GET_CONNECTION_STATUS" }
  | { type: "RESOLVE_YT_URL"; pageUrl: string };

export type ResolveYtUrlResponse =
  | { ok: true; result: ResolveUrlResult }
  | { ok: false; error: string; code?: number };

export type DownloadYtResponse =
  | { ok: true; result: YouTubeDownloadResult }
  | { ok: false; error: string; code?: number };

export interface ConnectionStatusResponse {
  connected: boolean;
}

// ── Video overlay (detect module) ──

// OverlayOption represents one entry in the dropdown. Two flavours:
//   - Direct URL (`url` non-empty): the click hands off to the existing
//     CapturedDownload pipeline (or chrome.downloads fallback).
//   - Daemon-mediated (`daemonRequest` set, `url` may be ""): the click
//     sends a DOWNLOAD_YT_VIDEO message; daemon resolves URLs and downloads
//     (with ffmpeg mux when audioFormatId is present).
export interface OverlayOption {
  label: string;
  sublabel?: string;
  url: string;
  fileName?: string;
  group?: string;
  daemonRequest?: {
    videoId: string;
    videoFormatId: string;
    audioFormatId?: string;
  };
}
