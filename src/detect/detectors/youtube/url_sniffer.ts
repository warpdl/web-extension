/**
 * URL sniffer — intercepts fetch/XHR calls from YouTube's own player to
 * capture already-decoded googlevideo.com URLs (signature + n-param applied
 * by YouTube internally). This bypasses the entire signature-decoding
 * problem by using YouTube's real JavaScript engine instead of our own
 * regex-based reverse engineering.
 *
 * Captures URLs keyed by itag. Each YouTubeFormat entry carries an `itag`
 * field; matching captured URLs lets us serve the right URL for each format.
 *
 * Must be installed at document_start BEFORE YouTube's player loads.
 */

type ItagUrlCache = Map<number, string>;
type UrlListener = (itag: number, url: string) => void;

const listeners = new Set<UrlListener>();
let installed = false;
const cache: ItagUrlCache = new Map();

export function installSniffer(): void {
  if (installed) return;
  installed = true;

  hookFetch();
  hookXhr();
}

export function getCapturedUrl(itag: number): string | undefined {
  return cache.get(itag);
}

export function getCapturedItags(): number[] {
  return Array.from(cache.keys());
}

export function onUrlCaptured(listener: UrlListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper — clears state so each test starts clean. */
export function __resetSniffer(): void {
  installed = false;
  listeners.clear();
  cache.clear();
}

function maybeCapture(rawUrl: string): void {
  // Fast reject: only googlevideo.com URLs with itag.
  if (!rawUrl.includes("googlevideo.com")) return;
  const itagMatch = rawUrl.match(/[?&]itag=(\d+)/);
  if (!itagMatch) return;

  // Must carry a signature AND/OR a decoded n-param. If neither is present,
  // this isn't a signed URL — probably a non-format request like a stats ping.
  // (Heuristic: real format URLs always have `sig=`, `signature=`, `lsig=`, or a
  // transformed `n=`. We just require itag + googlevideo which is already
  // strong filter.)

  const itag = parseInt(itagMatch[1], 10);
  if (!Number.isFinite(itag)) return;

  // Store only the first URL we see per itag (subsequent fetches for the same
  // itag are usually byte-range continuations with the same query string).
  if (cache.has(itag)) return;

  cache.set(itag, rawUrl);
  for (const l of listeners) {
    try { l(itag, rawUrl); } catch { /* listener errors must not break hooks */ }
  }
}

function hookFetch(): void {
  const orig = window.fetch;
  // Skip if not available in this environment (e.g., older browsers).
  if (typeof orig !== "function") return;

  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      let url: string;
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.toString();
      else if (input && typeof (input as Request).url === "string") url = (input as Request).url;
      else url = String(input);
      maybeCapture(url);
    } catch { /* capture must not break fetch */ }
    return orig.apply(this, [input, init] as [RequestInfo | URL, RequestInit | undefined]);
  };
}

function hookXhr(): void {
  const Xhr = window.XMLHttpRequest;
  if (typeof Xhr !== "function") return;

  const origOpen = Xhr.prototype.open;

  Xhr.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    isAsync?: boolean,
    user?: string | null,
    password?: string | null
  ): void {
    try {
      const u = typeof url === "string" ? url : url.toString();
      maybeCapture(u);
    } catch { /* ignore */ }

    return origOpen.call(this, method, url, isAsync as boolean, user, password);
  };
}
