import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import type { Clock } from "../core/clock";
import type { State } from "./state";
import { isLegalTransition } from "./state";
import { nextDelay } from "./backoff";
import { encodeCapturedDownload } from "./protocol";
import { validateDaemonUrl } from "../capture/url_validator";
import type { CapturedDownload } from "../types";

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "idle" | "connecting" | "reconnecting" | "disabled" | "connection_lost" };

interface Deps {
  bus: EventBus;
  log: Logger;
  clock: Clock;
  wsFactory: (url: string) => WebSocket;
  disableHeartbeat?: boolean;
  disableBreaker?: boolean;
  breakerThreshold?: number;
  heartbeatMs?: number;
}

export class DaemonClient {
  private bus: EventBus;
  private log: Logger;
  private clock: Clock;
  private wsFactory: (url: string) => WebSocket;

  private _state: State = "IDLE";
  private _url: string | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private consecutiveFailures = 0;
  private breakerEnabled: boolean;
  private breakerThreshold: number;

  constructor(deps: Deps) {
    this.bus = deps.bus;
    this.log = deps.log;
    this.clock = deps.clock;
    this.wsFactory = deps.wsFactory;
    this.breakerEnabled = !(deps.disableBreaker ?? false);
    this.breakerThreshold = deps.breakerThreshold ?? 10;
  }

  get state(): State {
    return this._state;
  }

  get url(): string | null {
    return this._url;
  }

  setUrl(raw: string): void {
    const v = validateDaemonUrl(raw);
    if (!v.ok) {
      this._url = raw;
      this.teardown();
      this.transition("DISABLED", `invalid_url:${v.error}`);
      return;
    }
    const normalized = `${v.host}:${v.port}`;
    if (this._url === normalized && (this._state === "OPEN" || this._state === "CONNECTING")) return;
    this._url = normalized;
    if (this._state === "IDLE") return;   // stay IDLE until start()
    this.teardown();
    this.consecutiveFailures = 0;
    this.transition("CONNECTING");
  }

  start(): void {
    if (this._state !== "IDLE") return;   // idempotent
    if (this._url === null) return;
    this.transition("CONNECTING");
  }

  stop(): void {
    this.teardown();
    this.transition("IDLE");
  }

  resume(): void {
    if (this._state !== "DISABLED") return;
    this.consecutiveFailures = 0;
    this.transition("CONNECTING");
  }

  send(msg: CapturedDownload): SendResult {
    if (this._state !== "OPEN" || this.socket === null) {
      switch (this._state) {
        case "IDLE": return { ok: false, reason: "idle" };
        case "CONNECTING": return { ok: false, reason: "connecting" };
        case "RECONNECTING": return { ok: false, reason: "reconnecting" };
        case "DISABLED": return { ok: false, reason: "disabled" };
        default: return { ok: false, reason: "connection_lost" };
      }
    }
    try {
      this.socket.send(encodeCapturedDownload(msg));
      return { ok: true };
    } catch (e) {
      this.log.error("send_failed", {}, e);
      this.transition("RECONNECTING", "send_throw");
      return { ok: false, reason: "connection_lost" };
    }
  }

  // ── Internals ───────────────────────────────────────────────

  private transition(to: State, cause?: string): void {
    const from = this._state;
    if (from === to && to !== "IDLE") {
      // Self-transitions are noops except IDLE→IDLE (stop idempotency).
      return;
    }
    if (!isLegalTransition(from, to)) {
      this.log.warn("illegal_transition", { from, to, cause });
      return;
    }

    this._state = to;
    this.bus.emit("daemon:state", { from, to, cause });
    this.log.info("state_transition", { from, to, cause });

    this.onEnter(to, cause);
  }

  private onEnter(state: State, cause?: string): void {
    switch (state) {
      case "CONNECTING": this.openSocket(); break;
      case "OPEN":       this.consecutiveFailures = 0; break;
      case "RECONNECTING": this.scheduleReconnect(cause); break;
      case "DISABLED":   this.teardown(); break;
      case "IDLE":       /* already torn down by stop() */ break;
    }
  }

  private openSocket(): void {
    if (this._url === null) return;
    try {
      this.socket = this.wsFactory(this._url);
    } catch (e) {
      this.log.error("ws_construct_failed", {}, e);
      this.transition("RECONNECTING", "ws_construct_throw");
      return;
    }
    this.socket.onopen = () => this.transition("OPEN");
    this.socket.onclose = () => this.transition("RECONNECTING", "onclose");
    this.socket.onerror = () => {
      this.log.warn("ws_error", {});
      // onclose is expected to follow; don't transition here
    };
  }

  private scheduleReconnect(cause?: string): void {
    this.clearSocketHandlers();
    if (this.socket !== null) {
      try { this.socket.close(); } catch { /* noop */ }
      this.socket = null;
    }
    if (cause === "onclose" || cause === "ws_construct_throw" || cause === "send_throw" || cause === "heartbeat_stalled") {
      this.consecutiveFailures++;
    }
    if (this.breakerEnabled && this.consecutiveFailures >= this.breakerThreshold) {
      this.transition("DISABLED", "breaker_tripped");
      return;
    }
    const delay = nextDelay(this.consecutiveFailures - 1);
    this.reconnectTimer = this.clock.setTimeout(() => {
      this.reconnectTimer = null;
      this.transition("CONNECTING", "backoff_fired");
    }, delay);
  }

  private teardown(): void {
    if (this.reconnectTimer !== null) {
      this.clock.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearSocketHandlers();
    if (this.socket !== null) {
      try { this.socket.close(); } catch { /* noop */ }
      this.socket = null;
    }
  }

  private clearSocketHandlers(): void {
    if (this.socket === null) return;
    this.socket.onopen = null;
    this.socket.onclose = null;
    this.socket.onerror = null;
    this.socket.onmessage = null;
  }
}
