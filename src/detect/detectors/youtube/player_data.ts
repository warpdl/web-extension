export interface PlayerResponse {
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    author: string;
  };
  streamingData?: {
    formats?: YouTubeFormat[];
    adaptiveFormats?: YouTubeFormat[];
  };
}

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

export function getPlayerResponse(): PlayerResponse | null {
  // Strategy 1: window global
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.ytInitialPlayerResponse) {
      return w.ytInitialPlayerResponse as PlayerResponse;
    }
  } catch { /* ignore */ }

  // Strategy 2: parse from script tag contents
  try {
    const scripts = document.querySelectorAll("script");
    for (const script of Array.from(scripts)) {
      const text = script.textContent ?? "";
      const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      if (match?.[1]) {
        try {
          return JSON.parse(match[1]) as PlayerResponse;
        } catch { /* try next script */ }
      }
    }
  } catch { /* ignore */ }

  // Strategy 3: movie_player API
  try {
    const player = document.getElementById("movie_player") as unknown as {
      getPlayerResponse?: () => PlayerResponse;
    } | null;
    if (player?.getPlayerResponse) {
      return player.getPlayerResponse();
    }
  } catch { /* ignore */ }

  return null;
}
