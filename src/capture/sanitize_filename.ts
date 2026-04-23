const MAX_LEN = 200;
const FALLBACK = "download";

// Chars banned on Windows + control chars + path separators.
// Kept as a static regex so it's ReDoS-safe.
const BANNED = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitizeFilename(raw: string): string {
  let s = raw.replace(BANNED, "_");
  s = s.replace(/^\.+|\.+$/g, "");    // strip leading/trailing dots
  s = s.trim();
  if (s.length === 0) return FALLBACK;

  if (s.length > MAX_LEN) {
    const dot = s.lastIndexOf(".");
    if (dot > 0 && s.length - dot <= 10) {
      const ext = s.slice(dot);
      s = s.slice(0, MAX_LEN - ext.length) + ext;
    } else {
      s = s.slice(0, MAX_LEN);
    }
  }
  return s;
}
