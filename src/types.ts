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

// ── Internal messaging (content script / popup <-> service worker) ──

export type ExtensionMessage =
  | { type: "DOWNLOAD_VIDEO"; url: string; fileName?: string; pageUrl?: string }
  | { type: "GET_CONNECTION_STATUS" };

export interface ConnectionStatusResponse {
  connected: boolean;
}

// ── YouTube types ──

export interface YouTubeFormat {
  url?: string;
  signatureCipher?: string;
  mimeType: string;
  qualityLabel?: string;
  bitrate?: number;
  contentLength?: string;
  width?: number;
  height?: number;
  audioQuality?: string;
}

export interface YouTubeStreamingData {
  formats?: YouTubeFormat[];
  adaptiveFormats?: YouTubeFormat[];
}

export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  lengthSeconds: string;
  author: string;
}

export interface YouTubePlayerResponse {
  videoDetails?: YouTubeVideoDetails;
  streamingData?: YouTubeStreamingData;
}
