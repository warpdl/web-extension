/**
 * Background-side capture of YouTube googlevideo.com URLs.
 *
 * Runs in the service worker. Uses chrome.webRequest which sees ALL network
 * activity from the tab, including Service-Worker-proxied requests that are
 * invisible to main-world fetch/XHR hooks and the Performance API.
 *
 * Storage is per-tab so URLs from one YouTube tab don't leak to another.
 * Keyed by itag — each itag captured once (byte-range continuations ignored).
 */

type ItagMap = Map<number, string>;

const PER_TAB: Map<number, ItagMap> = new Map();
const GOOGLEVIDEO_RE = /\/\/[^/]*googlevideo\.com\//;

export function captureYtUrls(): void {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) return;
      if (!GOOGLEVIDEO_RE.test(details.url)) return;
      const itagMatch = details.url.match(/[?&]itag=(\d+)/);
      if (!itagMatch) return;
      const itag = parseInt(itagMatch[1], 10);
      if (!Number.isFinite(itag)) return;

      let tab = PER_TAB.get(details.tabId);
      if (!tab) {
        tab = new Map();
        PER_TAB.set(details.tabId, tab);
      }
      if (tab.has(itag)) return;  // first-wins
      tab.set(itag, details.url);

      // Push to the tab so the content script can forward to the main world.
      try {
        chrome.tabs.sendMessage(details.tabId, {
          type: "YT_URL_CAPTURED",
          itag,
          url: details.url,
        }).catch(() => { /* tab may not have our content script yet */ });
      } catch { /* chrome.tabs unavailable in test */ }
    },
    { urls: ["*://*.googlevideo.com/*"] }
  );

  // Clean up when tabs close.
  chrome.tabs.onRemoved.addListener((tabId) => {
    PER_TAB.delete(tabId);
  });

  // Clean up when a tab navigates to a new top-level URL.
  chrome.webNavigation?.onBeforeNavigate?.addListener?.((details) => {
    if (details.frameId === 0) PER_TAB.delete(details.tabId);
  });
}

export function getCapturedForTab(tabId: number): Array<{ itag: number; url: string }> {
  const tab = PER_TAB.get(tabId);
  if (!tab) return [];
  return Array.from(tab.entries()).map(([itag, url]) => ({ itag, url }));
}

/** Test helper. */
export function __resetYtUrlCapture(): void {
  PER_TAB.clear();
}
