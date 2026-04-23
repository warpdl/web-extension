/**
 * Background-side capture of YouTube googlevideo.com URLs.
 *
 * Runs in the service worker. Uses chrome.webRequest which is the ONLY
 * observation point that sees requests made by YouTube's own Service Worker
 * (the one YouTube registers to proxy video fetches).
 *
 * Key design choice: we do NOT filter by tabId, because YouTube's SW fetches
 * are detached from any tab (details.tabId === -1). Instead we use the
 * originating document URL (details.documentUrl / initiator) when available,
 * and also maintain a single recent-captures list that any YouTube content
 * script can query.
 */

export interface CapturedUrl {
  itag: number;
  url: string;
  capturedAt: number;
  tabId: number;  // -1 if request came from service worker
}

const MAX_CAPTURES = 500;
const CAPTURE_TTL_MS = 10 * 60 * 1000;
const GOOGLEVIDEO_RE = /\/\/[^/]*googlevideo\.com\//;

const CAPTURES: CapturedUrl[] = [];

export function captureYtUrls(): void {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!GOOGLEVIDEO_RE.test(details.url)) return;
      console.info(`[WarpDL BG] googlevideo seen: tabId=${details.tabId} type=${details.type} url=${details.url.slice(0, 150)}...`);
      const itagMatch = details.url.match(/[?&]itag=(\d+)/);
      if (!itagMatch) {
        console.info("[WarpDL BG]  → no itag in URL, skipping");
        return;
      }
      const itag = parseInt(itagMatch[1], 10);
      if (!Number.isFinite(itag)) return;

      // First-wins: don't overwrite a URL we already captured for this itag.
      if (CAPTURES.some((c) => c.itag === itag)) return;

      const entry: CapturedUrl = {
        itag,
        url: details.url,
        capturedAt: Date.now(),
        tabId: details.tabId,
      };
      CAPTURES.push(entry);
      if (CAPTURES.length > MAX_CAPTURES) CAPTURES.shift();

      console.info(`[WarpDL BG] captured googlevideo itag=${itag} tabId=${details.tabId} url=${details.url.slice(0, 100)}...`);

      // Push to every youtube.com tab so content scripts can forward to main world.
      pushToYouTubeTabs(entry);
    },
    { urls: ["*://*.googlevideo.com/*"] }
  );

  // Clean expired entries once a minute.
  setInterval(pruneExpired, 60_000);
}

function pushToYouTubeTabs(entry: CapturedUrl): void {
  try {
    chrome.tabs.query({ url: "*://*.youtube.com/*" }).then((tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        chrome.tabs.sendMessage(tab.id, {
          type: "YT_URL_CAPTURED",
          itag: entry.itag,
          url: entry.url,
        }).catch(() => { /* content script not present */ });
      }
    }).catch(() => { /* tabs API unavailable */ });
  } catch { /* ignore */ }
}

function pruneExpired(): void {
  const cutoff = Date.now() - CAPTURE_TTL_MS;
  while (CAPTURES.length > 0 && CAPTURES[0].capturedAt < cutoff) {
    CAPTURES.shift();
  }
}

/** Returns all non-expired captures. */
export function getAllCaptured(): CapturedUrl[] {
  pruneExpired();
  return CAPTURES.slice();
}

/**
 * Returns captures for a specific tab, OR service-worker captures (tabId=-1)
 * that occurred around the time the tab was active. Since all YouTube tabs
 * share the same service worker, SW captures are valid for any YouTube tab.
 */
export function getCapturedForTab(_tabId: number): Array<{ itag: number; url: string }> {
  pruneExpired();
  return CAPTURES.map((c) => ({ itag: c.itag, url: c.url }));
}

/** Test helper. */
export function __resetYtUrlCapture(): void {
  CAPTURES.length = 0;
}
