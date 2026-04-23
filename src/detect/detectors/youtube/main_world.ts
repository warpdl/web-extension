import { getPlayerResponse } from "./player_data";
import { loadBaseJs, findBaseJsUrl, __resetMemCache } from "./base_js_loader";
import { extractDecoders, Decoders } from "./signature";
import { buildOptions } from "./formats";
import type { YtBridgeMessage, YtExtractError } from "../../../types";

const NAV_DEBOUNCE_MS = 500;

let decoderCache: Decoders | null = null;

/** @internal — test helper only */
export function __resetDecoderCache(): void {
  decoderCache = null;
}

function post(message: YtBridgeMessage): void {
  window.postMessage(message, "*");
}

function postError(reason: YtExtractError, videoId: string | null): void {
  post({ source: "warpdl-yt-main", type: "formats-error", reason, videoId });
  console.warn("[WarpDL YT]", reason);
}

/** Test-overridable retry settings. */
export const __WAIT_CONFIG = {
  attempts: 20,
  intervalMs: 250,
};

async function waitFor<T>(fn: () => T | null | undefined): Promise<T | null> {
  for (let i = 0; i < __WAIT_CONFIG.attempts; i++) {
    const v = fn();
    if (v) return v;
    if (i < __WAIT_CONFIG.attempts - 1) {
      await new Promise((r) => setTimeout(r, __WAIT_CONFIG.intervalMs));
    }
  }
  return null;
}

async function handleRequestFormats(): Promise<void> {
  const pr = await waitFor(() => {
    const r = getPlayerResponse();
    return r?.streamingData ? r : null;
  });
  if (!pr?.streamingData) {
    postError("no_player_response", null);
    return;
  }
  const videoId = pr.videoDetails?.videoId ?? null;

  const baseJsUrl = await waitFor(() => findBaseJsUrl());
  if (!baseJsUrl) {
    postError("base_js_fetch_failed", videoId);
    return;
  }

  let baseJs: string;
  try {
    baseJs = await loadBaseJs(baseJsUrl);
  } catch {
    postError("base_js_fetch_failed", videoId);
    return;
  }

  let decoders: Decoders;
  try {
    if (!decoderCache) decoderCache = extractDecoders(baseJs);
    decoders = decoderCache;
  } catch {
    // extractDecoders now never throws — it returns partial Decoders.
    // This catch is defensive only.
    decoders = { signature: null, nParam: null };
  }

  // Diagnostic warnings — the pipeline continues regardless.
  if (!decoders.signature) console.warn("[WarpDL YT] signature decoder unavailable; signatureCipher formats will be skipped");
  if (!decoders.nParam) console.warn("[WarpDL YT] n-param decoder unavailable; downloads may be throttled");

  let result;
  try {
    result = buildOptions(pr, decoders);
  } catch {
    postError("decode_exception", videoId);
    return;
  }

  const { options, totalFormats, decodedFormats } = result;

  // Spec §6.4: if > 50% of formats failed to decode, emit decode_exception
  if (totalFormats > 0 && decodedFormats / totalFormats < 0.5) {
    postError("decode_exception", videoId);
    return;
  }

  if (options.length === 0) {
    postError("no_formats", videoId);
    return;
  }

  post({
    source: "warpdl-yt-main",
    type: "formats-ready",
    options,
    videoId: videoId ?? "",
    title: pr.videoDetails?.title ?? "",
  });
}

function onBridgeMessage(ev: MessageEvent): void {
  // ev.source is null when message originates from the same window (jsdom/some browsers)
  if (ev.source !== null && ev.source !== window) return;
  const data = ev.data as YtBridgeMessage | null;
  if (!data || data.source !== "warpdl-yt-content") return;
  if (data.type === "request-formats") {
    void handleRequestFormats();
  }
}

let navTimer: number | null = null;
function onSpaNav(): void {
  if (navTimer !== null) {
    window.clearTimeout(navTimer);
  }
  navTimer = window.setTimeout(() => {
    navTimer = null;
    // Invalidate decoder cache since player may have changed too
    decoderCache = null;
    __resetMemCache();
    void handleRequestFormats();
  }, NAV_DEBOUNCE_MS);
}

export function runMainWorld(): () => void {
  window.addEventListener("message", onBridgeMessage);
  document.addEventListener("yt-navigate-finish", onSpaNav);
  post({ source: "warpdl-yt-main", type: "ready" });
  return () => {
    window.removeEventListener("message", onBridgeMessage);
    document.removeEventListener("yt-navigate-finish", onSpaNav);
    if (navTimer !== null) {
      window.clearTimeout(navTimer);
      navTimer = null;
    }
  };
}

// Auto-run unless imported by tests
declare const process: { env: Record<string, string | undefined> } | undefined;

/* c8 ignore next 12 */
if (
  typeof document !== "undefined" &&
  !(globalThis as any).__WARPDL_MAIN_WORLD_LOADED__ &&
  (typeof process === "undefined" || process.env.NODE_ENV !== "test")
) {
  (globalThis as any).__WARPDL_MAIN_WORLD_LOADED__ = true;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { runMainWorld(); });
  } else {
    runMainWorld();
  }
}
