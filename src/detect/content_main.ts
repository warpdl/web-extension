import { GenericDetector } from "./detectors/generic";
import { YouTubeDetector } from "./detectors/youtube/detector";
import type { Detector } from "./detector";

export function pickDetector(hostname: string): Detector {
  if (hostname === "www.youtube.com" || hostname.endsWith(".youtube.com")) {
    return new YouTubeDetector();
  }
  return new GenericDetector();
}

function boot(): void {
  const detector = pickDetector(location.hostname);
  detector.start();
  window.addEventListener("pagehide", () => detector.stop());
}

// Auto-run unless loaded by tests
declare const process: { env: Record<string, string | undefined> } | undefined;

if (
  typeof document !== "undefined" &&
  !(globalThis as any).__WARPDL_CONTENT_MAIN_LOADED__ &&
  (typeof process === "undefined" || process.env.NODE_ENV !== "test")
) {
  (globalThis as any).__WARPDL_CONTENT_MAIN_LOADED__ = true;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
