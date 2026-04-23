const MEM_CACHE = new Map<string, string>();
const STORAGE_PREFIX = "yt_base_js:";
const TTL_MS = 24 * 60 * 60 * 1000;

export function __resetMemCache(): void {
  MEM_CACHE.clear();
}

export function extractPlayerHash(url: string): string | null {
  const m = url.match(/\/s\/player\/([^/]+)\/player_ias\.vflset/);
  return m?.[1] ?? null;
}

export function findBaseJsUrl(): string | null {
  const scripts = document.querySelectorAll("script[src]");
  for (const node of Array.from(scripts)) {
    const src = (node as HTMLScriptElement).src;
    if (src.includes("/s/player/") && src.endsWith("base.js")) return src;
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
