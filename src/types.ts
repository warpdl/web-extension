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
  // Optional Bearer token for the daemon's /jsonrpc endpoint. Empty = no
  // authentication header sent. The /jsonrpc endpoint rejects requests
  // when the daemon was started with a secret set.
  daemonSecret?: string;
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
  title: string;
  author?: string;
  duration?: number;
  formats: ResolvedFormat[];
}

// ── Internal messaging (content script / popup <-> service worker) ──

export type ExtensionMessage =
  | { type: "DOWNLOAD_VIDEO"; url: string; fileName?: string; pageUrl?: string }
  | { type: "GET_CONNECTION_STATUS" }
  | { type: "RESOLVE_YT_URL"; pageUrl: string };

export type ResolveYtUrlResponse =
  | { ok: true; result: ResolveUrlResult }
  | { ok: false; error: string; code?: number };

export interface ConnectionStatusResponse {
  connected: boolean;
}

// ── Video overlay (detect module) ──

export interface OverlayOption {
  label: string;
  sublabel?: string;
  url: string;
  fileName?: string;
  group?: string;
}
