/**
 * Direct hook into YouTube's movie_player element — undocumented methods
 * sometimes expose decoded media URLs. Also includes a diagnostic probe that
 * dumps every candidate method for the user to share, so we can discover
 * working APIs without re-engineering from scratch each time YouTube changes.
 *
 * Strategy:
 *   1. Find document.getElementById('movie_player')
 *   2. Check a known allowlist of method names that have historically returned
 *      useful URL info: getVideoStats, getStatsForNerds, getVideoData, etc.
 *   3. Also probe any method whose name suggests URLs (getUrl, getStreamUrl).
 *   4. Report findings.
 */

export interface PlayerUrls {
  // Map of itag -> URL for formats the player has resolved internally.
  byItag: Map<number, string>;
  // Raw diagnostics: methods tried and their return shapes.
  diagnostics: string[];
}

const URL_METHOD_CANDIDATES = [
  "getStreamUrl",
  "getVideoUrl",
  "getMediaUrl",
  "getPlaybackUrl",
  "getSrc",
  "getSource",
  "getVideoSrc",
];

const INFO_METHOD_CANDIDATES = [
  "getStatsForNerds",
  "getVideoStats",
  "getVideoData",
  "getPlayerState",
  "getPlaybackQuality",
  "getAvailableQualityLabels",
  "getAvailableQualityLevels",
  "getCurrentVideoConfig",
];

/**
 * Scans the movie_player element for any method that might expose decoded URLs.
 * Returns a diagnostic report plus any URLs found.
 */
export function probePlayer(): PlayerUrls {
  const out: PlayerUrls = { byItag: new Map(), diagnostics: [] };
  const player = document.getElementById("movie_player") as unknown as Record<string, unknown> | null;
  if (!player) {
    out.diagnostics.push("no movie_player element");
    return out;
  }

  out.diagnostics.push("movie_player found");

  // Try URL-returning methods
  for (const name of URL_METHOD_CANDIDATES) {
    const fn = player[name];
    if (typeof fn === "function") {
      try {
        const result = (fn as () => unknown).call(player);
        const extracted = extractItagsFromAny(result);
        out.diagnostics.push(`${name}() returned: ${summarize(result)}; itags=${extracted.length}`);
        for (const [itag, url] of extracted) out.byItag.set(itag, url);
      } catch (e) {
        out.diagnostics.push(`${name}() threw: ${String(e).slice(0, 80)}`);
      }
    }
  }

  // Try info methods — harvest URLs from returned objects
  for (const name of INFO_METHOD_CANDIDATES) {
    const fn = player[name];
    if (typeof fn === "function") {
      try {
        const result = (fn as () => unknown).call(player);
        const extracted = extractItagsFromAny(result);
        if (extracted.length > 0) {
          out.diagnostics.push(`${name}() has URLs: itags=${extracted.map(([t]) => t).join(",")}`);
          for (const [itag, url] of extracted) out.byItag.set(itag, url);
        } else {
          out.diagnostics.push(`${name}() → ${summarize(result)}`);
        }
      } catch (e) {
        out.diagnostics.push(`${name}() threw: ${String(e).slice(0, 80)}`);
      }
    }
  }

  // List all function-valued own-properties so we can discover new methods
  const allMethods: string[] = [];
  for (const key in player) {
    if (typeof player[key] === "function" && key.length < 40) {
      allMethods.push(key);
    }
  }
  out.diagnostics.push(`all methods (${allMethods.length}): ${allMethods.slice(0, 60).join(",")}${allMethods.length > 60 ? "..." : ""}`);

  return out;
}

/**
 * Recursively walk a value (object/array) looking for googlevideo.com URLs
 * with itag params. Returns [itag, url] pairs.
 */
function extractItagsFromAny(value: unknown, depth = 0): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  if (depth > 4) return out;
  if (value == null) return out;

  if (typeof value === "string") {
    if (value.includes("googlevideo.com")) {
      const m = value.match(/[?&]itag=(\d+)/);
      if (m) {
        const itag = parseInt(m[1], 10);
        if (Number.isFinite(itag)) out.push([itag, value]);
      }
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const v of value) out.push(...extractItagsFromAny(v, depth + 1));
    return out;
  }

  if (typeof value === "object") {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      try {
        out.push(...extractItagsFromAny((value as Record<string, unknown>)[k], depth + 1));
      } catch { /* ignore unreadable props */ }
    }
  }

  return out;
}

function summarize(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === "string") return "str(" + value.length + ")";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return `object{${keys.slice(0, 10).join(",")}${keys.length > 10 ? "..." : ""}}`;
  }
  return typeof value;
}
