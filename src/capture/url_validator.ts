export type ValidationError =
  | "empty"
  | "contains_scheme"
  | "contains_path"
  | "missing_port"
  | "port_out_of_range"
  | "invalid_host_chars"
  | "too_long"
  | "malformed";

export type ValidationResult =
  | { ok: true; host: string; port: number }
  | { ok: false; error: ValidationError };

const MAX_LEN = 253;
const HOST_NAME_CHARS = /^[A-Za-z0-9._-]+$/;   // anchored, no backtracking

export function validateDaemonUrl(raw: string): ValidationResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (trimmed.length > MAX_LEN) return { ok: false, error: "too_long" };

  // Scheme check
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return { ok: false, error: "contains_scheme" };
  }

  // Path check: slash anywhere
  if (trimmed.includes("/")) {
    return { ok: false, error: "contains_path" };
  }

  // IPv6 form: [host]:port
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close < 0) return { ok: false, error: "malformed" };
    const host = trimmed.slice(0, close + 1);
    const remainder = trimmed.slice(close + 1);
    if (remainder.length === 0) return { ok: false, error: "missing_port" };
    if (!remainder.startsWith(":")) return { ok: false, error: "malformed" };
    const portStr = remainder.slice(1);
    if (portStr.length === 0) return { ok: false, error: "missing_port" };
    const port = parsePort(portStr);
    if (port === null) return { ok: false, error: "port_out_of_range" };
    // Minimal IPv6 content check
    const inner = host.slice(1, -1);
    if (inner.length === 0 || !/^[0-9a-fA-F:]+$/.test(inner)) {
      return { ok: false, error: "invalid_host_chars" };
    }
    return { ok: true, host, port };
  }

  // Host:port form
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon < 0) return { ok: false, error: "missing_port" };
  if (lastColon === 0) return { ok: false, error: "malformed" };

  const host = trimmed.slice(0, lastColon);
  const portStr = trimmed.slice(lastColon + 1);

  if (portStr.length === 0) return { ok: false, error: "missing_port" };
  if (host.length === 0) return { ok: false, error: "malformed" };

  // Reject any additional colons in the host portion (IPv6 without brackets, etc.)
  if (host.includes(":")) return { ok: false, error: "invalid_host_chars" };

  if (!HOST_NAME_CHARS.test(host)) {
    return { ok: false, error: "invalid_host_chars" };
  }

  const port = parsePort(portStr);
  if (port === null) return { ok: false, error: "port_out_of_range" };

  return { ok: true, host, port };
}

function parsePort(s: string): number | null {
  if (!/^[0-9]+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return n;
}
