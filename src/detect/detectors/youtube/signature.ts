import type { YouTubeFormat } from "./player_data";

export interface Decoders {
  signature: ((s: string) => string) | null;
  nParam: ((n: string) => string) | null;
}

/**
 * Call-site patterns that identify the signature function name.
 * Ordered most-specific → most-general. First match wins.
 * Based on yt-dlp's evolving pattern set — add new patterns when YouTube changes.
 */
const SIG_NAME_PATTERNS: RegExp[] = [
  /\.set\("alr","yes"\)[^;]*?c=([a-zA-Z_$][\w$]*)\(decodeURIComponent\(c\)\)/,
  /;c&&\(c=([a-zA-Z_$][\w$]*)\(decodeURIComponent\(c\)\)/,
  /\bm=([a-zA-Z_$][\w$]*)\(decodeURIComponent\(h\.s\)\)/,
  /\bc&&\(c=([a-zA-Z_$][\w$]*)\(decodeURIComponent\(c\)\)/,
  // Definition patterns
  /\b([a-zA-Z_$][\w$]*)\s*=\s*function\s*\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)[\s\S]+?return\s+a\.join\(\s*""\s*\)\s*\}/,
  /([a-zA-Z_$][\w$]*)\s*=\s*function\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)\s*\{\s*\2\s*=\s*\2\.split\(\s*""\s*\)\s*;/,
  /\b([a-zA-Z_$][\w$]*)\s*=\s*function\s*\([a-zA-Z_$][\w$]*?\)\s*\{[a-zA-Z_$][\w$]*?=[a-zA-Z_$][\w$]*?\.split\(""\)[\s\S]+?\.join\(""\)\}/,
];

const N_NAME_PATTERNS: RegExp[] = [
  /&&\(b=a\.get\("n"\)\)&&\(b=([a-zA-Z_$][\w$]*)(?:\[\d+\])?\(b\)/,
  /\.get\("n"\)\)&&\(b=([a-zA-Z_$][\w$]*)(?:\[\d+\])?\(b\)/,
  /\.get\("n"\)[^)]*\)&&\(b?=([a-zA-Z_$][\w$]*)\(/,
  /([a-zA-Z_$][\w$]*)=function\(a\)\{a=a\.split\(""\);[\s\S]+?\.join\(""\)\}/,
];

/**
 * Attempts to extract signature and n-param decoders from base.js.
 * Returns a Decoders object where either or both may be null if extraction fails.
 * Does NOT throw — partial extraction is better than none (direct-URL formats still work
 * even without a signature decoder, and n-param failure just means throttled downloads).
 */
export function extractDecoders(baseJs: string): Decoders {
  let signature: ((s: string) => string) | null = null;
  let nParam: ((n: string) => string) | null = null;

  const sigName = tryPatterns(baseJs, SIG_NAME_PATTERNS, null);
  if (sigName) {
    try {
      signature = buildFunction(baseJs, sigName, "s");
    } catch {
      signature = null;
    }
  }

  const nName = tryPatterns(baseJs, N_NAME_PATTERNS, sigName);
  if (nName) {
    try {
      nParam = buildFunction(baseJs, nName, "n");
    } catch {
      nParam = null;
    }
  }

  return { signature, nParam };
}

function tryPatterns(text: string, patterns: RegExp[], exclude: string | null): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1] && m[1] !== exclude) return m[1];
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFunction(baseJs: string, name: string, argName: string): (x: string) => string {
  const escaped = escapeRegex(name);
  const bodyMatch = baseJs.match(new RegExp(escaped + "\\s*=\\s*function\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]+?)\\};"));
  if (!bodyMatch) throw new Error("function_body_not_found: " + name);
  const [, params, body] = bodyMatch;

  // Find helper object referenced in the body. Shape: identifier.method(...).
  // Skip names that are function parameters (e.g. the argument variable itself).
  const paramNames = new Set(params.split(",").map((p) => p.trim()).filter(Boolean));
  let helperObjSrc = "";
  let helperObjMatch: RegExpMatchArray | null = null;
  for (const m of body.matchAll(/\b([a-zA-Z_$][\w$]*)\.[a-zA-Z_$][\w$]*\(/g)) {
    if (!paramNames.has(m[1])) { helperObjMatch = m; break; }
  }
  if (helperObjMatch) {
    const objName = helperObjMatch[1];
    const objDefMatch = baseJs.match(new RegExp("\\bvar\\s+" + escapeRegex(objName) + "\\s*=\\s*\\{([\\s\\S]+?)\\};"));
    if (objDefMatch) {
      helperObjSrc = "var " + objName + "={" + objDefMatch[1] + "};";
    }
  }

  const fullSrc = helperObjSrc + "var " + name + "=function(" + params + "){" + body + "}; return " + name + "(" + argName + ");";
  try {
    return new Function(argName, fullSrc) as (x: string) => string;
  } catch (e) {
    throw new Error("function_build_failed: " + (e instanceof Error ? e.message : String(e)));
  }
}

export function decodeFormatUrl(format: YouTubeFormat, decoders: Decoders): string | null {
  let url: string;
  if (format.signatureCipher) {
    // Without a signature decoder, signatureCipher formats are unusable.
    if (!decoders.signature) return null;

    const params = new URLSearchParams(format.signatureCipher);
    const s = params.get("s");
    const sp = params.get("sp") ?? "sig";
    const baseUrl = params.get("url");
    if (!s || !baseUrl) return null;
    let signed: string;
    try {
      signed = decoders.signature(s);
    } catch {
      return null;
    }
    url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + sp + "=" + encodeURIComponent(signed);
  } else if (format.url) {
    url = format.url;
  } else {
    return null;
  }

  // n-param transform (best-effort). If no n-decoder or it throws, leave n untouched;
  // the URL is still usable but downloads will be throttled to ~50 KB/s by YouTube.
  if (decoders.nParam) {
    try {
      const parsed = new URL(url);
      const n = parsed.searchParams.get("n");
      if (n) {
        try {
          const nDecoded = decoders.nParam(n);
          parsed.searchParams.set("n", nDecoded);
          url = parsed.toString();
        } catch {
          // Leave n untouched.
        }
      }
    } catch {
      // Malformed URL; return as-is.
    }
  }
  return url;
}
