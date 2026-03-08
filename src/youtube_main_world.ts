// YouTube MAIN world script — self-contained IIFE, no imports
// Extracts ytInitialPlayerResponse and posts to content script via window.postMessage
export {};

(function () {
  const SOURCE = "warpdl-youtube-main";

  interface PlayerResponse {
    videoDetails?: unknown;
    streamingData?: unknown;
  }

  function extractPlayerResponse(): PlayerResponse | null {
    // Method 1: Global variable
    try {
      const w = window as unknown as Record<string, unknown>;
      if (w.ytInitialPlayerResponse) {
        return w.ytInitialPlayerResponse as PlayerResponse;
      }
    } catch {
      // ignore
    }

    // Method 2: Parse from script tags
    try {
      const scripts = document.querySelectorAll("script");
      for (const script of scripts) {
        const text = script.textContent || "";
        const match = text.match(
          /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s
        );
        if (match?.[1]) {
          return JSON.parse(match[1]) as PlayerResponse;
        }
      }
    } catch {
      // ignore
    }

    // Method 3: movie_player API
    try {
      const player = document.getElementById("movie_player") as unknown as {
        getPlayerResponse?: () => PlayerResponse;
      } | null;
      if (player?.getPlayerResponse) {
        return player.getPlayerResponse();
      }
    } catch {
      // ignore
    }

    return null;
  }

  function sendPlayerData(): void {
    const data = extractPlayerResponse();
    if (data) {
      window.postMessage({ source: SOURCE, type: "PLAYER_DATA", data }, "*");
    } else {
      window.postMessage(
        { source: SOURCE, type: "PLAYER_DATA", data: null },
        "*"
      );
    }
  }

  // Listen for re-extraction requests from content script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (
      event.data?.source === "warpdl-youtube-content" &&
      event.data?.type === "REQUEST_PLAYER_DATA"
    ) {
      // Small delay to let YouTube populate data after SPA navigation
      setTimeout(sendPlayerData, 500);
    }
  });

  // Initial extraction after page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(sendPlayerData, 1000);
    });
  } else {
    setTimeout(sendPlayerData, 1000);
  }
})();
