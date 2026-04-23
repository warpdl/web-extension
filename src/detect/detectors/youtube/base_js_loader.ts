const MEM_CACHE = new Map<string, string>();
const STORAGE_PREFIX = "yt_base_js:";
const TTL_MS = 24 * 60 * 60 * 1000;

export function __resetMemCache(): void {
  MEM_CACHE.clear();
}

export function extractPlayerHash(url: string): string | null {
  const m = url.match(/\/s\/player\/([^/]+)\//);
  return m?.[1] ?? null;
}

function absolutize(url: string): string {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

function looksLikeBaseJs(url: string): boolean {
  // Match anything under /s/player/<hash>/ whose filename is base.js,
  // with or without a query string. Covers every player variant
  // (player_ias, player-plasma-ias-phone, tv-player-ias, etc).
  return /\/s\/player\/[^/]+\/.+\/base\.js(\?|$)/.test(url);
}

export function findBaseJsUrl(): string | null {
  // Strategy 1: ytcfg (present in main world after YouTube bootstraps).
  try {
    const w = window as unknown as {
      ytcfg?: { get?: (k: string) => unknown; data_?: Record<string, unknown> };
    };
    const fromGet = typeof w.ytcfg?.get === "function" ? w.ytcfg.get("PLAYER_JS_URL") : undefined;
    if (typeof fromGet === "string" && fromGet.length > 0) return absolutize(fromGet);
    const fromData = w.ytcfg?.data_?.["PLAYER_JS_URL"];
    if (typeof fromData === "string" && fromData.length > 0) return absolutize(fromData);
  } catch { /* ignore */ }

  // Strategy 2: <script src> scan.
  const scripts = document.querySelectorAll("script[src]");
  for (const node of Array.from(scripts)) {
    const src = (node as HTMLScriptElement).src;
    if (looksLikeBaseJs(src)) return src;
  }

  // Strategy 3: <link rel="preload"> scan (some YouTube variants preload the player).
  const links = document.querySelectorAll('link[rel="preload"][href]');
  for (const node of Array.from(links)) {
    const href = (node as HTMLLinkElement).href;
    if (looksLikeBaseJs(href)) return href;
  }

  return null;
}

export async function loadBaseJs(url: string): Promise<string> {
  const hash = extractPlayerHash(url);
  if (!hash) throw new Error("base_js_url_malformed: " + url);

  const cached = MEM_CACHE.get(hash);
  if (cached !== undefined) return cached;

  try {
    const data = await chrome.storage.local.get(STORAGE_PREFIX + hash);
    const entry = data[STORAGE_PREFIX + hash] as { body: string; storedAt: number } | undefined;
    if (entry && Date.now() - entry.storedAt < TTL_MS) {
      MEM_CACHE.set(hash, entry.body);
      return entry.body;
    }
  } catch { /* chrome.storage unavailable in test; fall through */ }

  const response = await fetch(url);
  if (!response.ok) throw new Error("base_js_fetch_failed: " + response.status);
  const body = await response.text();
  MEM_CACHE.set(hash, body);

  try {
    await chrome.storage.local.set({
      [STORAGE_PREFIX + hash]: { body, storedAt: Date.now() },
    });
  } catch { /* ignore persistence failures */ }

  return body;
}
