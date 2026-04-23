# WebSocket Ecosystem Hardening — Design

**Date:** 2026-04-23
**Status:** Draft — pending user review
**Author:** warpdl-webextension maintainers
**Approach:** Full rewrite into event-driven modular architecture with test framework (Approach C)

---

## 1. Goal

Make the extension's WebSocket communication with the WarpDL daemon **tightly stable** and **resistant to user misconfiguration**. Keep the existing wire protocol unchanged — the daemon side is not modified by this work.

### 1.1 In scope

- **Stability:** state-machine-driven connection lifecycle, heartbeat, jittered reconnect, circuit breaker, service-worker lifecycle correctness, header-store TTL, race-free init.
- **User-misconfiguration security:** daemon URL syntax validation at input time and at every `setUrl` call.
- **Observability:** structured logging with redaction, ring buffer surfaced in popup diagnostics, typed event bus.
- **Offline UX:** fall back to the browser's native download when the daemon is not connected — no queueing.
- **Testing:** Vitest harness with ≥95% coverage gate on the new modules.

### 1.2 Out of scope (explicit)

- Authentication, Origin enforcement, WSS, message signing, native messaging host.
- LAN/private-network URL restrictions (accept any syntactically valid `host:port`).
- Defense against malicious web pages or other local processes.
- Protocol versioning / migration of the wire format.
- Playwright end-to-end tests (manual smoke checklist only).
- CI pipeline setup (deferred to a later PR).

---

## 2. Audit of current code

### 2.1 Security findings (scoped to user-misconfiguration)

| # | Issue | Location |
|---|---|---|
| S1 | Daemon URL accepts arbitrary hosts without syntax validation | `src/settings.ts`, `public/popup.html:138` |
| S4 | No scheme/port checks; `ws://evil.com:3850` silently accepted | `src/popup.ts:51-57` |

Remaining findings (S2, S3, S5, S6) are intentionally **not addressed**, per the agreed threat model.

### 2.2 Stability findings

| # | Issue | Location |
|---|---|---|
| T1 | No heartbeat — dead TCP can stay `OPEN` indefinitely | `src/service_worker.ts:13-114` |
| T2 | Failed `send()` dropped silently, no user feedback | `src/service_worker.ts:70-79` |
| T3 | `onerror` only logs; relies on `onclose` firing afterward | `src/service_worker.ts:53-55` |
| T4 | MV3 service-worker sleep leaves stale socket state | lifecycle-wide |
| T5 | No jitter on exponential backoff | `src/service_worker.ts:104-113` |
| T6 | No circuit breaker — unbounded retries without user feedback | `src/service_worker.ts` |
| T7 | `onSettingsChanged` can fire before `daemon` is constructed | `src/service_worker.ts:128-137` |
| T8 | Header store never trims entries if webRequest events don't fire | `src/service_worker.ts:120-187` |

---

## 3. Architecture

### 3.1 Module layout

```
src/
├─ core/
│  ├─ events.ts           # Typed EventBus (publish/subscribe, strict event schema)
│  ├─ container.ts        # Manual DI wiring for the service worker entrypoint
│  └─ logger.ts           # Structured leveled logger with redaction + ring buffer
├─ daemon/
│  ├─ client.ts           # DaemonClient state machine
│  ├─ state.ts            # State enum + legal transition table (pure data)
│  ├─ backoff.ts          # Jittered exponential backoff (pure function)
│  └─ protocol.ts         # Wire-format types + encoder (pure functions)
├─ capture/
│  ├─ header_store.ts     # TTL-based LRU cache for captured request headers
│  ├─ url_validator.ts    # Parse and validate "host:port" daemon URLs
│  ├─ cookie_mapper.ts    # chrome.cookies.Cookie → DaemonCookie (pure)
│  └─ sanitize_filename.ts # Centralized filename sanitization (pure)
├─ downloads/
│  ├─ interceptor.ts      # chrome.downloads.onCreated handler + fallback
│  ├─ video_handler.ts    # DOWNLOAD_VIDEO message handler + fallback
│  └─ send_or_fallback.ts # Unified decision helper
├─ messaging/
│  └─ router.ts           # chrome.runtime.onMessage dispatch
├─ settings/
│  └─ settings.ts         # Loading, saving, change listeners
├─ service_worker.ts      # Entry point: constructs container, wires events
├─ popup.ts               # Rich status via chrome.runtime.Port subscription
├─ content_script.ts      # unchanged
├─ youtube_content.ts     # unchanged
├─ youtube_main_world.ts  # unchanged
└─ types.ts               # Shared types

tests/
├─ unit/                  # per-module unit tests, deps mocked
├─ integration/           # end-to-end wire-up with mocked chrome + FakeWebSocket
└─ fixtures/              # chrome_mock.ts, fake_websocket.ts, fake_clock.ts, setup.ts
```

### 3.2 Dependency rules

- `core/` depends on nothing inside `src/` except `types.ts`.
- `daemon/` depends on `core/` only.
- `capture/` depends on nothing inside `src/` except `types.ts`.
- `downloads/` depends on `core/`, `daemon/`, `capture/`.
- `messaging/` depends on `core/`, `downloads/`.
- `service_worker.ts` depends on everything via `core/container.ts`. Nothing else imports `service_worker.ts`.

### 3.3 Event bus

One typed `EventBus` instance, passed through the container to every module. No module imports another module's concrete class when an event suffices.

```ts
interface Events {
  "daemon:state":      { from: State; to: State; cause?: string };
  "daemon:error":      { where: string; cause: unknown };
  "daemon:message":    { payload: CapturedDownload };
  "send:outcome":      { kind: "sent" | "fallback" | "drop"; reason?: string };
  "settings:changed":  { settings: ExtensionSettings };
  "settings:applied":  { url: string; interceptEnabled: boolean };
}

class EventBus {
  on<K extends keyof Events>(evt: K, cb: (p: Events[K]) => void): () => void;
  emit<K extends keyof Events>(evt: K, payload: Events[K]): void;
}
```

### 3.4 Dependency injection

No DI framework. The container constructs modules in topological order and passes collaborators as constructor args. Tests wire a container with fakes. Example:

```ts
class Container {
  readonly ready: Promise<void>;
  private readyResolve!: () => void;

  bus!:     EventBus;
  log!:     Logger;
  daemon!:  DaemonClient;
  headers!: HeaderStore;

  constructor() {
    this.ready = new Promise(r => { this.readyResolve = r; });
  }

  async start() {
    const settings = await loadSettings();
    this.bus     = new EventBus();
    this.log     = new Logger({ bus: this.bus });
    this.daemon  = new DaemonClient({
      bus: this.bus, log: this.log.child("daemon"),
      wsFactory: (u) => new WebSocket(`ws://${u}`), clock: realClock,
    });
    this.headers = new HeaderStore({ clock: realClock, log: this.log.child("headers") });
    this.daemon.setUrl(settings.daemonUrl);
    this.daemon.start();

    onSettingsChanged(s => this.daemon.setUrl(s.daemonUrl));
    this.readyResolve();
  }
}
```

All top-level chrome event handlers `await container.ready` before acting — fixes T7.

---

## 4. DaemonClient state machine

### 4.1 States

| State | Meaning | `send()` result |
|---|---|---|
| `IDLE` | No socket, not trying to connect. Initial state; state after `stop()`. | `{ ok: false, reason: "idle" }` |
| `CONNECTING` | `new WebSocket(...)` issued, waiting for `open` / `error`. | `{ ok: false, reason: "connecting" }` |
| `OPEN` | Socket `readyState === 1` and last heartbeat within window. | `{ ok: true }` |
| `RECONNECTING` | Socket closed unexpectedly; backoff timer armed. | `{ ok: false, reason: "reconnecting" }` |
| `DISABLED` | Circuit breaker tripped (≥10 consecutive failures) or invalid URL. Manual resume required. | `{ ok: false, reason: "disabled" }` |

### 4.2 Legal transitions

```
 from           to              trigger
 ──────────────────────────────────────────────────────────
 IDLE          → CONNECTING     start()
 CONNECTING    → OPEN           ws.onopen
 CONNECTING    → RECONNECTING   ws.onerror or ws.onclose before open
 OPEN          → RECONNECTING   ws.onclose, or heartbeat stall
 OPEN          → IDLE           stop()
 RECONNECTING  → CONNECTING     backoff timer fires
 RECONNECTING  → DISABLED       consecutiveFailures >= 10
 RECONNECTING  → IDLE           stop()
 DISABLED      → CONNECTING     setUrl() with new value, or resume()
 *             → IDLE           stop() (idempotent)
```

All transitions pass through a single `transition(to, cause?)` function. Illegal transitions:
- Development build: throw (catches programmer errors in tests).
- Production build: log at `warn`, noop.

### 4.3 Heartbeat (workaround for missing WebSocket ping API)

Browsers cannot initiate protocol-level `ping` frames. The client uses an application-level heartbeat plus `bufferedAmount` inspection:

- Every **20 seconds** in `OPEN` state, send `{"type":"ping"}` as a JSON text frame.
- After send, sample `socket.bufferedAmount`. If it is non-zero **for two consecutive ticks** (≈40 s), the TCP write queue is not draining → force-close the socket → transition to `RECONNECTING` with cause `"heartbeat_stalled"`.
- **Protocol-compatibility caveat.** The daemon unmarshals each frame into a `capturedDownload{url, headers, cookies}` struct. Go's `json.Unmarshal` ignores unknown fields (`type`), so the struct parses cleanly — but all three fields are zero-valued (empty `url`). Whether the daemon then attempts to *process* that empty download (log, error, retry, ignore) is daemon-dependent. If it does anything harmful, the heartbeat is unsafe as-is. See §9.4 for the pre-commit-9 verification gate and §11 for the fallback plan.

### 4.4 Backoff

```ts
// daemon/backoff.ts — pure
export function nextDelay(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);  // 1s, 2s, 4s … 30s cap
  const jitter = (Math.random() - 0.5) * base * 0.3;   // ±15%
  return Math.max(100, base + jitter);
}
```

### 4.5 Circuit breaker

- `consecutiveFailures` increments on every `CONNECTING → RECONNECTING` edge.
- Resets to 0 on `CONNECTING → OPEN`.
- At ≥10 (≈5 minutes with the 30-second cap), transition to `DISABLED` with cause `"breaker_tripped"`.
- `DISABLED` persists until `setUrl(newUrl)` or `resume()` (popup Retry button).

### 4.6 Public API

```ts
class DaemonClient {
  constructor(deps: {
    bus: EventBus;
    log: Logger;
    wsFactory: (url: string) => WebSocket;
    clock: Clock;
  });

  start(): void;
  stop(): void;
  resume(): void;                           // exit DISABLED
  setUrl(raw: string): void;                // validates internally
  send(msg: CapturedDownload): SendResult;  // sync, never throws
  get state(): State;
  get url(): string | null;
}

type SendResult =
  | { ok: true }
  | { ok: false; reason: "idle" | "connecting" | "reconnecting" | "disabled" | "connection_lost" };
```

---

## 5. Data flow

### 5.1 Path A — browser-initiated download (`chrome.downloads.onCreated`)

```
chrome.downloads.onCreated
  │
  ▼
DownloadInterceptor
  ├─ settings.intercept === false     ──▶ return (browser proceeds)
  ├─ url scheme !∈ {http, https}      ──▶ return (browser proceeds)
  ├─ daemon.state !== OPEN            ──▶ return (browser proceeds)   ← FALLBACK
  │
  ▼
Build CapturedDownload:
  url      = finalUrl || url
  headers  = headerStore.get(url)  (Cookie header stripped)
  cookies  = chrome.cookies.getAll({ url })  (graceful degrade if denied)
  │
  ▼
daemon.send(msg)
  ├─ { ok: true }    ──▶ chrome.downloads.cancel + erase
  └─ { ok: false }   ──▶ log, do nothing (browser completes the download)
```

**Fallback rule:** if the state check passes but `send()` races and fails, we do **not** cancel. The browser keeps downloading. The user gets the file once, either way.

### 5.2 Path B — content-script video button (`DOWNLOAD_VIDEO`)

```
chrome.runtime.sendMessage({ type: "DOWNLOAD_VIDEO", url, pageUrl, fileName? })
  │
  ▼
MessageRouter → VideoHandler
  ├─ daemon.state !== OPEN
  │      ──▶ chrome.downloads.download({ url, filename: sanitize(fileName) })
  │      ──▶ reply { sent: false, fallback: true }
  │
  ▼ daemon.state === OPEN
Build CapturedDownload from url + Referer + cookies
  │
  ▼
daemon.send(msg)
  ├─ { ok: true }    ──▶ reply { sent: true,  fallback: false }
  └─ { ok: false }   ──▶ chrome.downloads.download fallback
                          reply { sent: false, fallback: true }
```

Response shape is always well-formed; the content-script overlay uses the flags to pick its label ("Sent to WarpDL" vs "Downloading").

### 5.3 Header store lifecycle (fixes T8)

```
onBeforeSendHeaders  ──▶ store.set(url, headers, ttl=60s)
onBeforeRedirect     ──▶ store.migrate(oldUrl, newUrl)
onCompleted          ──▶ store.delete(url)
onErrorOccurred      ──▶ store.delete(url)
background sweep 30s ──▶ remove expired entries
```

`HeaderStore`:
- `set(url, headers)` stamps `expiresAt = clock.now() + 60_000`.
- `get(url)` returns `undefined` if expired (and deletes the entry).
- LRU cap at 1000 entries; overflow evicts least-recently-accessed.
- Periodic sweep every 30 s removes expired entries regardless of webRequest events.

### 5.4 Popup status

| DaemonClient state | Popup dot | Popup text | Extra UI |
|---|---|---|---|
| `OPEN` | green | Connected | — |
| `CONNECTING` | yellow | Connecting… | — |
| `RECONNECTING` | yellow | Reconnecting… (attempt N/10) | — |
| `DISABLED` | red | Daemon unreachable | **Retry** button |
| `IDLE` | grey | Not started | (not normally visible) |

Popup opens a `chrome.runtime.Port` to subscribe to `daemon:state` events — status updates live while the popup is open. Port is closed on popup unload.

---

## 6. Security hardening

### 6.1 Daemon URL validation (`capture/url_validator.ts`)

```ts
type ValidationError =
  | "empty"
  | "contains_scheme"
  | "contains_path"
  | "missing_port"
  | "port_out_of_range"
  | "invalid_host_chars"
  | "too_long"
  | "malformed";

export function validateDaemonUrl(raw: string):
  | { ok: true;  host: string; port: number }
  | { ok: false; error: ValidationError };
```

Rules (loose — user can point anywhere syntactically valid):

| Rule | Accept | Reject |
|---|---|---|
| `host:port` format required | `localhost:3850`, `[::1]:3850`, `192.168.1.5:3850`, `my.host.lan:8080` | `localhost`, `:3850`, `host:` |
| Port is integer 1–65535 | `3850` | `0`, `65536`, `abc` |
| No URL scheme | | `ws://host:3850`, `http://host:3850` |
| No path | | `host:3850/`, `host:3850/foo` |
| Host chars: alphanumerics, `.`, `-`, `_`, or bracketed IPv6 | `a-b.lan`, `[fe80::1]` | `a b`, `a|b`, control chars |
| Total length ≤ 253 | | 500-char input rejected fast |

**Enforcement points:**
1. Popup Save button — invalid input shows inline error, nothing persisted.
2. `DaemonClient.setUrl()` — re-validates even from storage (defensive).
3. Pure function; table-driven unit tests cover every branch and regex ReDoS safety.

### 6.2 Settings init race (fixes T7)

Container exposes `ready: Promise<void>`. All chrome event handlers `await container.ready` before acting. `onSettingsChanged` is registered only inside `start()` after `daemon` is constructed.

### 6.3 Collateral hardening

- **Log redaction by default.** `cookies`, `Set-Cookie`, `Authorization`, `Cookie` values → `"[redacted]"`. URL query strings stripped. Payload bodies logged by size/key-count only. `chrome.storage.local.set({ debug: true })` disables redaction.
- **Filename sanitization** centralized in `capture/sanitize_filename.ts` (one set of rules for both content scripts and the video fallback path).

### 6.4 Explicit non-goals

- No authentication — any local process can connect to the daemon.
- No Origin enforcement — daemon-side concern.
- No WSS / cert pinning — plain `ws://` on loopback.
- No message signing.
- `host_permissions` remains `https://*/*`, `http://*/*` — required for cookie and header capture on any download origin.

---

## 7. Error handling & observability

### 7.1 Error categories

| Category | Rule |
|---|---|
| **Expected** — documented failure mode | Return typed result (e.g. `SendResult`, `ValidationResult`). Never throw. |
| **Recoverable** — unexpected but survivable | Catch at module boundary, log `warn`, return safe default, emit `daemon:error`. |
| **Bug** — programmer error, illegal state | Log `error`, emit diagnostic event, continue if possible. In dev, throw. |

### 7.2 Logger

```ts
interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info (msg: string, ctx?: Record<string, unknown>): void;
  warn (msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>, err?: unknown): void;
  child(scope: string): Logger;
}
```

Output example:
```
[14:23:01.234] [daemon] INFO  state_transition from=CONNECTING to=OPEN url=localhost:3850
[14:23:45.123] [daemon] WARN  heartbeat_stalled buffered=8192 for_ms=40200
```

### 7.3 Unhandled rejection safety net

```ts
self.addEventListener("unhandledrejection", (e) => {
  logger.error("unhandled_rejection", {}, e.reason);
  e.preventDefault();
});
self.addEventListener("error", (e) => {
  logger.error("uncaught_exception", { message: e.message, at: `${e.filename}:${e.lineno}` });
});
```

### 7.4 Ring buffer in `chrome.storage.local`

- Last 100 `warn`+`error` events, circular, ~10 KB cap.
- Accessible from popup via hidden "Diagnostics" panel (triple-click the header to reveal).
- Users can copy the contents when reporting bugs.

### 7.5 Per-module error paths

| Module | Failure | Handling |
|---|---|---|
| `DaemonClient` | `new WebSocket()` throws | Caught in `transition(CONNECTING)` → `RECONNECTING` |
| `DaemonClient` | `socket.send()` throws mid-call | Return `{ ok: false, reason: "connection_lost" }`, transition to `RECONNECTING` |
| `DaemonClient` | Heartbeat stall | Force-close, transition to `RECONNECTING`, cause `"heartbeat_stalled"` |
| `DaemonClient` | Invalid URL in `setUrl()` | Transition to `DISABLED`, cause `"invalid_url"` |
| `DownloadInterceptor` | `chrome.cookies.getAll` rejects | Warn, send with empty cookies |
| `DownloadInterceptor` | `chrome.downloads.cancel` rejects | Warn, no erase — possible duplicate in tray (acceptable) |
| `VideoHandler` | `chrome.downloads.download` rejects | Reply `{ sent: false, fallback: false, error: "download_api_failed" }` |
| `HeaderStore` | Sweep failure | Log, skip this tick, retry next |
| `MessageRouter` | Handler throws | Top-level try/catch, reply `{ error: string }` |

### 7.6 Popup error UX

| Situation | Popup shows |
|---|---|
| URL validation fails on Save | Red inline message; field not saved |
| State `DISABLED` | Red banner + **Retry** + "View diagnostics" link |
| Last send fell back | Yellow dot briefly (2 s), tooltip describing cause |
| Intercept toggle off | Grey banner: "Interception disabled" |

---

## 8. Testing strategy

### 8.1 Framework

**Vitest** (+ `@vitest/coverage-v8`, `jsdom` for popup DOM tests).

Rationale: native TypeScript/ESM, ~5× faster than Jest on this codebase, Jest-compatible API, built-in coverage, useful watch mode.

### 8.2 Mocking

All mocks are hand-rolled and small — no `sinon-chrome` / `jest-webextension-mock` dependencies.

- `tests/fixtures/chrome_mock.ts` — typed mock of the ~10 chrome APIs we use.
- `tests/fixtures/fake_websocket.ts` — `FakeWebSocket` with `simulateOpen()`, `simulateClose(code?)`, `simulateError()`.
- `tests/fixtures/fake_clock.ts` — `FakeClock` with `now`, `setTimeout`, `clearTimeout`, `tick(ms)`.
- `tests/fixtures/setup.ts` — installs `globalThis.chrome`, stubs `WebSocket`.

### 8.3 Coverage targets

| Module | Approx. tests | Focus |
|---|---|---|
| `daemon/backoff.ts` | 10 | Cap, jitter range, first/last attempt |
| `daemon/client.ts` | 40 | Every transition, heartbeat, circuit breaker, `send()` per state, `setUrl` re-validation |
| `daemon/protocol.ts` | 6 | Encoder output shape, redaction |
| `capture/header_store.ts` | 15 | Set/get, TTL expiry, LRU eviction, sweep, migrate |
| `capture/url_validator.ts` | 25 | Every error branch, IPv6, length overflow (10 000 chars), trimming |
| `capture/cookie_mapper.ts` | 8 | SameSite mapping, Expires ISO formatting, missing fields |
| `capture/sanitize_filename.ts` | 8 | Path traversal, reserved names (Windows), length cap, unicode |
| `downloads/interceptor.ts` | 12 | Intercept-off, non-HTTP, not-OPEN, cookie denied, happy path |
| `downloads/video_handler.ts` | 8 | Fallback paths, referer, sanitized filename |
| `core/events.ts` | 6 | Subscribe/emit, unsubscribe, error isolation |
| `core/logger.ts` | 10 | Redaction, levels, ring buffer cap, child scope |
| `messaging/router.ts` | 5 | Dispatch, unknown type, handler rejection |
| `tests/integration/service_worker.test.ts` | 10 | Boot, reconnect, URL change, breaker trip, popup port |

### 8.4 Coverage gate

```ts
// vitest.config.ts (excerpt)
coverage: {
  provider: "v8",
  include: ["src/**/*.ts"],
  exclude: [
    "src/service_worker.ts",          // entry point — covered by integration
    "src/popup.ts",                   // DOM layer — manual + jsdom spot checks
    "src/content_script.ts",
    "src/youtube_*.ts",
    "src/types.ts",
  ],
  thresholds: { lines: 95, functions: 95, branches: 95, statements: 95 },
}
```

Build fails locally (and in CI once added) on threshold breach.

### 8.5 Not auto-tested (explicit)

- Popup DOM interactions — manual smoke test. (Optional jsdom tests possible; low ROI now.)
- YouTube content scripts — DOM-coupled to YouTube SPA, brittle in isolation. Covered by manual smoke checklist.
- Real browser end-to-end — deferred.

### 8.6 Manual smoke checklist (shipped in `docs/specs/`)

1. Fresh install → popup "Connecting…" → daemon up → "Connected".
2. Kill daemon → popup flips to "Reconnecting…".
3. Daemon stays down 5+ minutes → popup shows "Daemon unreachable" + Retry.
4. Click Retry → attempts again; if daemon is up now, reaches OPEN.
5. Normal HTTP download with daemon connected → intercepted, forwarded, browser shows no download.
6. Same download with daemon disconnected → browser completes the download normally.
7. YouTube button → format picker → choose format → forwarded to daemon.
8. YouTube button with daemon offline → falls back to `chrome.downloads.download()`.

---

## 9. Migration path

### 9.1 Ordering principle

Build leaves first (pure modules, dead code in the bundle). Keep the current service worker functional at every intermediate commit. A single cut-over commit flips the world.

### 9.2 Commit sequence

| # | Commit | Ship-safe? |
|---|---|---|
| 1 | Add `vitest` + `@vitest/coverage-v8` + `jsdom` devDeps, `vitest.config.ts`, npm scripts | Yes |
| 2 | Add `tests/fixtures/` (chrome mock, fake WebSocket, fake clock, setup) | Yes |
| 3 | Add `src/core/` (events, logger, container skeleton) + tests | Yes — unused |
| 4 | Add `src/daemon/backoff.ts` + `protocol.ts` + `state.ts` + tests | Yes — unused |
| 5 | Add `src/capture/url_validator.ts` + `cookie_mapper.ts` + `header_store.ts` + `sanitize_filename.ts` + tests | Yes — unused |
| 6 | Add `src/daemon/client.ts` + tests | Yes — unused |
| 7 | Add `src/downloads/interceptor.ts` + `video_handler.ts` + `send_or_fallback.ts` + tests | Yes — unused |
| 8 | Add `src/messaging/router.ts` + tests | Yes — unused |
| 9 | **Cut-over:** rewrite `src/service_worker.ts` to use container; delete obsolete inline code | ⚠️ Breaking — single flag day |
| 10 | Rework `src/popup.ts` + `public/popup.html`: rich status, Retry button, diagnostics panel | Safe if 9 has landed |

Each commit lands with its tests and must pass `npm run test:coverage` ≥ 95 % before merge.

### 9.3 Rollback

If Commit 9 regresses post-merge:
- `git revert <commit-9>` restores the previous `service_worker.ts`.
- Commits 1–8 and 10 stay in place; their new modules become unreachable and are tree-shaken out of the bundle.
- Fix forward on a branch, re-apply cut-over.

### 9.4 Heartbeat compatibility verification (pre-commit-9 gate)

Before Commit 9 lands, run this against a local daemon:

1. Connect a WebSocket client to `ws://localhost:3850/`.
2. Send `{"type":"ping"}` (no `url`, no `headers`, no `cookies`).
3. Inspect daemon behavior:
   - **Acceptable:** frame is silently ignored, socket remains open, no log noise, no side-effects.
   - **Unacceptable:** socket closes, daemon errors, or a phantom download entry appears.

If the result is unacceptable, downgrade heartbeat to TCP-keepalive-only (rely on OS-level keepalive + `onclose`; lose ~20–40 s of fast-fail detection but regain daemon compatibility). Document the outcome in the Commit 9 message. A second option if upgrade is acceptable: add a discriminator field on the daemon side in a parallel daemon-repo PR — out of scope for this spec but worth flagging.

**Verification result (2026-04-23):** UNACCEPTABLE. Daemon parses every frame as a capturedDownload, producing 'unsupported protocol scheme ""' errors on empty-URL processing. Heartbeat disabled in production (`disableHeartbeat: true` in Container). Follow-up: add a message-type discriminator to the daemon WebSocket endpoint.

### 9.5 Dependency delta

```json
"devDependencies": {
  "vitest": "^2.1.0",
  "@vitest/coverage-v8": "^2.1.0",
  "jsdom": "^25.0.0"
}
```

No new runtime dependencies. Expected bundle growth: `dist/service_worker.js` from ~3 KB → ~6 KB gzipped.

### 9.6 Build system changes

- `webpack/webpack.config.js`: **no change**. Entry points, loader config stay the same; tree-shaking handles dead modules.
- `tsconfig.json`: add `"types": ["chrome", "vitest/globals"]`. Rest unchanged.
- `vitest.config.ts`: new file (see §8.4 excerpt).

### 9.7 File delta summary

```
add  vitest.config.ts
add  tests/                           (~14 files)
add  src/core/                        (3 files + tests)
add  src/daemon/                      (4 files + tests)
add  src/capture/                     (4 files + tests)
add  src/downloads/                   (3 files + tests)
add  src/messaging/                   (1 file + tests)
mod  src/service_worker.ts            (rewritten, ~40 lines)
mod  src/popup.ts                     (port subscriber)
mod  public/popup.html                (retry button, diagnostics panel)
mod  src/settings/settings.ts         (moved, minor cleanup)
mod  package.json                     (devDeps + scripts)
mod  tsconfig.json                    (types array)
keep src/types.ts
keep src/content_script.ts
keep src/youtube_*.ts
keep webpack/webpack.config.js
```

---

## 10. Acceptance criteria

- [ ] `npm run test:coverage` passes at ≥95 % lines/branches/functions/statements on the new modules.
- [ ] `npm run build` produces a valid `dist/` loadable as an unpacked extension.
- [ ] All 8 manual smoke scenarios (§8.6) pass against a running daemon.
- [ ] Popup reflects live `DaemonClient` state while open.
- [ ] Invalid URL in popup does not persist and is signaled to the user.
- [ ] Killing the daemon while an intercept is in flight leaves the user with the file (via browser fallback) and no stale `Downloads` entry.
- [ ] After 10 failed reconnects the popup shows `DISABLED` + Retry; Retry returns the client to `CONNECTING`.
- [ ] `DEBUG=true` in `chrome.storage.local` enables verbose logs; default remains redacted.
- [ ] Ring buffer contains the last 100 warn+error events, viewable from popup diagnostics.

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Daemon rejects `{"type":"ping"}` heartbeat | Low | §9.4 verification gate; fallback to TCP-keepalive-only |
| `chrome.runtime.Port` unreliable across SW sleep | Medium | Popup reconnects port on `onDisconnect`; falls back to one-shot `sendMessage` poll |
| Ring buffer writes hammer `chrome.storage.local` | Low | Debounce writes (1s); `storage.local` quota is 5 MB — ample |
| Coverage gate blocks legitimate work | Medium | Exclusions list (entry points, content scripts) is explicit and reviewed |
| Tree-shake leaves dead modules in bundle | Low | Webpack production mode with sideEffects: false on our modules; verify bundle size after Commit 9 |

---

## 12. Open questions (tracked for implementation)

None — all clarifying questions were resolved during brainstorming. If new questions surface during implementation, they are raised in the PR, not resolved silently.
