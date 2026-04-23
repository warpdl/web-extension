import type { EventBus } from "./events";

export type Level = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: Level;
  scope: string;
  msg: string;
  ctx?: Record<string, unknown>;
  ts: number;
}

interface LoggerDeps {
  bus: EventBus;
  writer?: (line: string) => void;
  clock?: () => number;
  debug?: () => boolean;
  ringSize?: number;
}

const SENSITIVE_KEYS = new Set(["cookie", "cookies", "set-cookie", "authorization"]);

export function redactUrl(url: string): string {
  if (!url) return url;
  const q = url.indexOf("?");
  if (q < 0) return url;
  return url.slice(0, q + 1) + "…";
}

export function redactContext(ctx: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!ctx) return ctx;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else if (k.toLowerCase() === "url" && typeof v === "string") {
      out[k] = redactUrl(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function fmtCtx(ctx?: Record<string, unknown>): string {
  if (!ctx || Object.keys(ctx).length === 0) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(ctx)) {
    parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return " " + parts.join(" ");
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export class Logger {
  private bus: EventBus;
  private writer: (line: string) => void;
  private clock: () => number;
  private debugFn: () => boolean;
  private scope: string;
  private ring: LogEntry[];
  private ringSize: number;

  constructor(deps: LoggerDeps, scope = "root", ring?: LogEntry[]) {
    this.bus = deps.bus;
    this.writer = deps.writer ?? ((line) => console.log(line));
    this.clock = deps.clock ?? (() => Date.now());
    this.debugFn = deps.debug ?? (() => false);
    this.scope = scope;
    this.ringSize = deps.ringSize ?? 100;
    this.ring = ring ?? [];
  }

  child(scope: string): Logger {
    return new Logger(
      { bus: this.bus, writer: this.writer, clock: this.clock, debug: this.debugFn, ringSize: this.ringSize },
      scope,
      this.ring,
    );
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.write("debug", msg, ctx);
  }
  info(msg: string, ctx?: Record<string, unknown>): void {
    this.write("info", msg, ctx);
  }
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.write("warn", msg, ctx);
  }
  error(msg: string, ctx?: Record<string, unknown>, err?: unknown): void {
    const merged = { ...(ctx ?? {}) };
    if (err !== undefined) {
      merged.err = err instanceof Error ? err.message : String(err);
    }
    this.write("error", msg, merged);
  }

  ringBuffer(): LogEntry[] {
    return this.ring.slice();
  }

  private write(level: Level, msg: string, ctx?: Record<string, unknown>): void {
    const redacted = this.debugFn() ? ctx : redactContext(ctx);
    const ts = this.clock();
    const line = `[${fmtTime(ts)}] [${this.scope}] ${level.toUpperCase().padEnd(5)} ${msg}${fmtCtx(redacted)}`;
    this.writer(line);
    this.bus.emit("log:entry", { level, scope: this.scope, msg, ctx: redacted });
    if (level === "warn" || level === "error") {
      this.ring.push({ level, scope: this.scope, msg, ctx: redacted, ts });
      while (this.ring.length > this.ringSize) this.ring.shift();
    }
  }
}
