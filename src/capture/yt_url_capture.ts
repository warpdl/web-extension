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

/**
 * YouTube SABR request bodies are protobufs. They contain an itag field
 * somewhere in the byte stream. Best-effort extraction: protobuf encodes
 * each field as (field_number << 3 | wire_type) followed by varint.
 *
 * YouTube's streaming protobuf puts itag as field 2 (guess based on
 * observed YouTube traffic — field numbers may vary). wire_type 0 = varint.
 * So we scan for the tag byte 0x10 (field 2, varint) followed by a small
 * integer that falls in known itag ranges.
 *
 * Known YouTube itag ranges: 18, 22, 43, 133-140, 160, 242-248, 249-251,
 * 271, 278, 298, 299, 302, 303, 308, 313, 315, 394-402, etc.
 * So itags are typically 2-3 digit integers < 1024.
 */
function tryExtractItagFromBody(body: chrome.webRequest.WebRequestBody): number | null {
  if (!body.raw || body.raw.length === 0) return null;

  for (const piece of body.raw) {
    const bytes = piece.bytes;
    if (!bytes) continue;
    const view = new Uint8Array(bytes);
    // Scan for (tag, varint) pairs. Tags 0x08 (field 1 varint), 0x10 (field 2
    // varint), 0x18 (field 3), 0x20 (field 4), 0x28 (field 5), 0x30 (field 6).
    // We specifically look for field 2 and field 1 (most likely for itag).
    for (let i = 0; i < view.length; i++) {
      const tag = view[i];
      if (tag === 0x08 || tag === 0x10 || tag === 0x18 || tag === 0x28) {
        // Read varint
        let val = 0;
        let shift = 0;
        let j = i + 1;
        while (j < view.length && j < i + 5) {
          const b = view[j];
          val |= (b & 0x7f) << shift;
          if ((b & 0x80) === 0) break;
          shift += 7;
          j++;
        }
        // itag values are 2-3 digit positive integers, typically 18-1024
        if (val >= 17 && val <= 1024) {
          return val;
        }
      }
    }
  }
  return null;
}

const CAPTURES: CapturedUrl[] = [];

export function captureYtUrls(): void {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!GOOGLEVIDEO_RE.test(details.url)) return;
      console.info(`[WarpDL BG] googlevideo seen: method=${details.method} type=${details.type} tabId=${details.tabId} urlLen=${details.url.length}`);
      console.info(`[WarpDL BG]   full url: ${details.url}`);

      // Try itag= in URL first (legacy format)
      let itag: number | null = null;
      const itagMatch = details.url.match(/[?&]itag=(\d+)/);
      if (itagMatch) {
        itag = parseInt(itagMatch[1], 10);
      } else if (details.requestBody) {
        // New SABR format: itag is in protobuf body. Try raw bytes decode.
        itag = tryExtractItagFromBody(details.requestBody);
        console.info(`[WarpDL BG]   body present: ${!!details.requestBody.raw || !!details.requestBody.formData}, itag from body=${itag}`);
      } else {
        console.info("[WarpDL BG]   no itag in URL, no body — skipping");
        return;
      }

      if (itag === null || !Number.isFinite(itag)) {
        console.info("[WarpDL BG]   couldn't determine itag — skipping");
        return;
      }

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
    { urls: ["*://*.googlevideo.com/*"] },
    ["requestBody"]
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
