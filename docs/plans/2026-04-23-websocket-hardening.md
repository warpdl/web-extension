# WebSocket Ecosystem Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the extension's WebSocket stack into modules with a state-machine-driven `DaemonClient`, URL validation, structured logging, browser-download fallback, and ≥95 % test coverage — without changing the daemon wire protocol.

**Architecture:** Single `EventBus` in `src/core/`. Pure helpers in `src/capture/` and `src/daemon/`. `DaemonClient` state machine (`IDLE → CONNECTING → OPEN → RECONNECTING → DISABLED`) in `src/daemon/client.ts`. `DownloadInterceptor` and `VideoHandler` in `src/downloads/` fall back to native browser downloads when the daemon isn't `OPEN`. `Container` wires everything in `src/core/container.ts`; `src/service_worker.ts` is just an entry point.

**Tech Stack:** TypeScript 5.5, Chrome Manifest V3 service worker, Webpack 5 (unchanged), Vitest 2.1 + `@vitest/coverage-v8` + `jsdom` for tests. No new runtime dependencies.

**Reference spec:** [`docs/specs/2026-04-23-websocket-hardening-design.md`](../specs/2026-04-23-websocket-hardening-design.md)

---

## File structure

New files (by task):

| Path | Task | Purpose |
|---|---|---|
| `vitest.config.ts` | 1 | Test runner + coverage config |
| `tests/fixtures/chrome_mock.ts` | 2 | Typed mock of `chrome.*` APIs |
| `tests/fixtures/fake_websocket.ts` | 2 | Controllable WebSocket double |
| `tests/fixtures/fake_clock.ts` | 2 | Controllable `setTimeout`/`now` |
| `tests/fixtures/setup.ts` | 2 | Global test setup (installs chrome mock) |
| `src/core/events.ts` | 3 | Typed `EventBus` |
| `src/core/logger.ts` | 4 | Leveled logger + redaction + ring buffer |
| `src/core/container.ts` | 5 | DI wiring (populated further in Task 21) |
| `src/daemon/state.ts` | 6 | State enum + transition table |
| `src/daemon/backoff.ts` | 7 | Jittered exponential backoff (pure) |
| `src/daemon/protocol.ts` | 8 | Wire encoder (pure) |
| `src/capture/url_validator.ts` | 9 | `validateDaemonUrl()` (pure) |
| `src/capture/cookie_mapper.ts` | 10 | `chrome.cookies.Cookie` → `DaemonCookie` (pure) |
| `src/capture/sanitize_filename.ts` | 11 | Filename sanitizer (pure) |
| `src/capture/header_store.ts` | 12 | TTL + LRU header cache |
| `src/daemon/client.ts` | 13–15 | `DaemonClient` state machine |
| `src/downloads/send_or_fallback.ts` | 16 | Unified decision helper |
| `src/downloads/interceptor.ts` | 17 | `chrome.downloads.onCreated` handler |
| `src/downloads/video_handler.ts` | 18 | `DOWNLOAD_VIDEO` message handler |
| `src/messaging/router.ts` | 19 | `chrome.runtime.onMessage` dispatch |
| `tests/integration/service_worker.test.ts` | 21 | End-to-end wiring tests |

Modified files:

| Path | Tasks | Change |
|---|---|---|
| `package.json` | 1 | Add Vitest devDeps + scripts |
| `tsconfig.json` | 1 | Add `types: ["chrome", "vitest/globals"]` |
| `src/service_worker.ts` | 21 | Rewrite as container entry point |
| `src/popup.ts` | 22 | Live-status port subscriber |
| `public/popup.html` | 22 | Retry button + diagnostics panel |
| `src/settings.ts` | 21 | Minor: re-export `onSettingsChanged` signature untouched |
| `src/types.ts` | 3, 13 | Add `State` enum export, `SendResult`, etc. |

---

## Task 0: Preparation

- [ ] **Step 1: Create worktree and confirm clean tree**

```bash
cd /home/celestix/projects/warpdl-webextension
git status                        # must be clean or only have this plan file
git checkout -b ws-hardening      # feature branch
```

Expected: on branch `ws-hardening`, `git status` shows no changes except possibly this plan.

- [ ] **Step 2: Confirm current build works before we touch anything**

```bash
npm run build
```

Expected: builds `dist/` successfully. No compile errors. If it fails, abort and investigate before continuing.

---

## Task 1: Add Vitest tooling

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Install dev dependencies**

```bash
npm install --save-dev vitest@^2.1.0 @vitest/coverage-v8@^2.1.0 jsdom@^25.0.0
```

Expected: installs with no errors. `package.json` devDependencies now includes the three entries.

- [ ] **Step 2: Add npm scripts to `package.json`**

Open `package.json` and replace the `"scripts"` block with:

```json
"scripts": {
  "build": "webpack --config webpack/webpack.config.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 3: Create `vitest.config.ts` at repo root**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["tests/fixtures/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/service_worker.ts",
        "src/popup.ts",
        "src/content_script.ts",
        "src/youtube_content.ts",
        "src/youtube_main_world.ts",
        "src/types.ts",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
```

- [ ] **Step 4: Update `tsconfig.json` to add Vitest globals**

Replace the entire file with:

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "commonjs",
    "target": "es2020",
    "esModuleInterop": true,
    "sourceMap": true,
    "rootDir": ".",
    "outDir": "dist/js",
    "noEmitOnError": true,
    "typeRoots": ["node_modules/@types"],
    "types": ["chrome", "vitest/globals", "node"]
  },
  "include": ["src/**/*", "tests/**/*", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Note: `rootDir` changed from `src` to `.` so TypeScript sees `tests/`. Webpack still only bundles from `src/` entry points, so output is unchanged.

- [ ] **Step 5: Install @types/node for Node globals used in tests**

```bash
npm install --save-dev @types/node@^20.0.0
```

- [ ] **Step 6: Verify `npm run build` still works**

```bash
npm run build
```

Expected: build succeeds unchanged. If TypeScript now complains about test files (shouldn't — webpack entry points don't include them), check `include` in `tsconfig.json`.

- [ ] **Step 7: Verify `npm test` runs (and exits quickly with no tests)**

```bash
npm test
```

Expected: Vitest prints "No test files found" or similar; exit code 0 or documented "no tests" code. This confirms the harness is wired.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: add Vitest + coverage harness"
```

---

## Task 2: Test fixtures

**Files:**
- Create: `tests/fixtures/chrome_mock.ts`
- Create: `tests/fixtures/fake_websocket.ts`
- Create: `tests/fixtures/fake_clock.ts`
- Create: `tests/fixtures/setup.ts`

Fixtures aren't unit-tested directly — they're exercised by every module test. We verify them by writing a trivial smoke test in this task that uses all three fakes.

- [ ] **Step 1: Create `tests/fixtures/fake_clock.ts`**

```ts
export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
}

interface Timer {
  id: number;
  fireAt: number;
  cb: () => void;
  interval?: number;
}

export class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private timers: Timer[] = [];

  now(): number {
    return this.currentTime;
  }

  setTimeout(cb: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, fireAt: this.currentTime + ms, cb });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  setInterval(cb: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, fireAt: this.currentTime + ms, cb, interval: ms });
    return id;
  }

  clearInterval(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  tick(ms: number): void {
    const target = this.currentTime + ms;
    while (true) {
      const next = this.timers
        .filter((t) => t.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!next) break;
      this.currentTime = next.fireAt;
      next.cb();
      if (next.interval !== undefined) {
        next.fireAt += next.interval;
      } else {
        this.timers = this.timers.filter((t) => t.id !== next.id);
      }
    }
    this.currentTime = target;
  }

  pendingTimers(): number {
    return this.timers.length;
  }
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms) as unknown as number,
  clearInterval: (id) => globalThis.clearInterval(id),
};
```

- [ ] **Step 2: Create `tests/fixtures/fake_websocket.ts`**

```ts
import { vi } from "vitest";

export class FakeWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  readyState: 0 | 1 | 2 | 3 = 0;
  bufferedAmount = 0;
  url: string;

  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;

  send = vi.fn((_data: string) => {
    /* tests can override via spy */
  });
  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = 3;
    setTimeout(() => this.onclose?.(new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" })), 0);
  });

  constructor(url: string) {
    this.url = url;
  }

  // Test-only API

  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  simulateClose(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }

  simulateError(): void {
    this.onerror?.(new Event("error"));
  }

  simulateMessage(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

export function makeWsFactory(): {
  factory: (url: string) => FakeWebSocket;
  lastSocket(): FakeWebSocket | null;
  allSockets(): FakeWebSocket[];
} {
  const sockets: FakeWebSocket[] = [];
  const factory = (url: string): FakeWebSocket => {
    const s = new FakeWebSocket(url);
    sockets.push(s);
    return s;
  };
  return {
    factory,
    lastSocket: () => sockets[sockets.length - 1] ?? null,
    allSockets: () => sockets,
  };
}
```

- [ ] **Step 3: Create `tests/fixtures/chrome_mock.ts`**

```ts
import { vi } from "vitest";

type Listener<T extends (...args: any[]) => any> = T;

function mkEvent<T extends (...args: any[]) => any>() {
  const listeners: Listener<T>[] = [];
  return {
    addListener: (l: T) => listeners.push(l),
    removeListener: (l: T) => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (l: T) => listeners.includes(l),
    fire: (...args: Parameters<T>) => {
      for (const l of listeners) l(...args);
    },
    listeners: () => listeners.slice(),
  };
}

function mkStorageArea() {
  const data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys === undefined || keys === null) return { ...data };
      if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (k in data) out[k] = data[k];
        return out;
      }
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(keys)) out[k] = k in data ? data[k] : (keys as any)[k];
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) delete data[k];
    }),
    clear: vi.fn(async () => {
      for (const k of Object.keys(data)) delete data[k];
    }),
    _raw: data,
  };
}

export function makeChromeMock() {
  const mock = {
    runtime: {
      onMessage: mkEvent<(msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void>(),
      onInstalled: mkEvent<(details: { reason: string }) => void>(),
      onConnect: mkEvent<(port: unknown) => void>(),
      sendMessage: vi.fn(async () => undefined),
      connect: vi.fn(() => ({
        onMessage: mkEvent<(msg: unknown) => void>(),
        onDisconnect: mkEvent<() => void>(),
        postMessage: vi.fn(),
        disconnect: vi.fn(),
      })),
      lastError: undefined as undefined | { message: string },
    },
    downloads: {
      onCreated: mkEvent<(item: { id: number; url: string; finalUrl?: string; filename?: string }) => void>(),
      cancel: vi.fn(async (_id: number) => undefined),
      erase: vi.fn(async (_query: { id: number }) => undefined),
      download: vi.fn(async (_opts: { url: string; filename?: string }) => 1),
    },
    cookies: {
      getAll: vi.fn(async (_q: { url: string }) => [] as chrome.cookies.Cookie[]),
    },
    storage: {
      sync: mkStorageArea(),
      local: mkStorageArea(),
      onChanged: mkEvent<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>(),
    },
    webRequest: {
      onBeforeSendHeaders: mkEvent<(details: { url: string; requestHeaders?: { name: string; value?: string }[] }) => void>(),
      onBeforeRedirect: mkEvent<(details: { url: string; redirectUrl: string }) => void>(),
      onCompleted: mkEvent<(details: { url: string }) => void>(),
      onErrorOccurred: mkEvent<(details: { url: string }) => void>(),
    },
    tabs: {
      create: vi.fn(async (_opts: { url: string }) => ({ id: 1 })),
    },
  };
  return mock;
}

export type ChromeMock = ReturnType<typeof makeChromeMock>;

export function installChromeMock(): ChromeMock {
  const mock = makeChromeMock();
  (globalThis as any).chrome = mock;
  return mock;
}

export function uninstallChromeMock(): void {
  delete (globalThis as any).chrome;
}
```

- [ ] **Step 4: Create `tests/fixtures/setup.ts`**

```ts
import { afterEach, beforeEach } from "vitest";
import { installChromeMock, uninstallChromeMock, ChromeMock } from "./chrome_mock";

// Make chrome available on globalThis before any test imports code that touches `chrome.*`.
// Individual tests can reset it via beforeEach.

declare global {
  // eslint-disable-next-line no-var
  var __chromeMock: ChromeMock;
}

beforeEach(() => {
  globalThis.__chromeMock = installChromeMock();
});

afterEach(() => {
  uninstallChromeMock();
});
```

- [ ] **Step 5: Write smoke test to verify fixtures load**

Create `tests/unit/fixtures.smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FakeClock } from "../fixtures/fake_clock";
import { FakeWebSocket, makeWsFactory } from "../fixtures/fake_websocket";

describe("fixtures smoke", () => {
  it("FakeClock ticks fire timers in order", () => {
    const clock = new FakeClock();
    const calls: string[] = [];
    clock.setTimeout(() => calls.push("b"), 200);
    clock.setTimeout(() => calls.push("a"), 100);
    clock.tick(150);
    expect(calls).toEqual(["a"]);
    clock.tick(100);
    expect(calls).toEqual(["a", "b"]);
  });

  it("FakeClock intervals fire repeatedly", () => {
    const clock = new FakeClock();
    let n = 0;
    clock.setInterval(() => n++, 100);
    clock.tick(350);
    expect(n).toBe(3);
  });

  it("FakeWebSocket simulates open/close/error", () => {
    const ws = new FakeWebSocket("ws://x");
    const events: string[] = [];
    ws.onopen = () => events.push("open");
    ws.onclose = () => events.push("close");
    ws.onerror = () => events.push("error");
    ws.simulateOpen();
    ws.simulateError();
    ws.simulateClose();
    expect(events).toEqual(["open", "error", "close"]);
    expect(ws.readyState).toBe(3);
  });

  it("wsFactory tracks sockets", () => {
    const { factory, lastSocket, allSockets } = makeWsFactory();
    factory("ws://a");
    factory("ws://b");
    expect(allSockets()).toHaveLength(2);
    expect(lastSocket()?.url).toBe("ws://b");
  });

  it("chrome mock is installed globally", () => {
    expect((globalThis as any).chrome).toBeDefined();
    expect((globalThis as any).chrome.runtime.sendMessage).toBeDefined();
  });
});
```

- [ ] **Step 6: Run the smoke test — must pass**

```bash
npm test -- tests/unit/fixtures.smoke.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures tests/unit/fixtures.smoke.test.ts
git commit -m "test: add chrome/WebSocket/Clock test fixtures"
```

---

## Task 3: `core/events.ts` — typed EventBus

**Files:**
- Create: `src/core/events.ts`
- Create: `tests/unit/core/events.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/core/events.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../../src/core/events";

describe("EventBus", () => {
  it("delivers events to subscribers", () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.on("daemon:state", spy);
    bus.emit("daemon:state", { from: "IDLE", to: "CONNECTING" });
    expect(spy).toHaveBeenCalledWith({ from: "IDLE", to: "CONNECTING" });
  });

  it("supports multiple subscribers on the same event", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("daemon:state", a);
    bus.on("daemon:state", b);
    bus.emit("daemon:state", { from: "IDLE", to: "CONNECTING" });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("returns an unsubscribe function that stops delivery", () => {
    const bus = new EventBus();
    const spy = vi.fn();
    const off = bus.on("daemon:state", spy);
    off();
    bus.emit("daemon:state", { from: "IDLE", to: "CONNECTING" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not deliver events to other event names", () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.on("daemon:state", spy);
    bus.emit("daemon:error", { where: "x", cause: "y" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("isolates subscriber errors — one failing subscriber does not block others", () => {
    const bus = new EventBus();
    const a = vi.fn(() => { throw new Error("boom"); });
    const b = vi.fn();
    bus.on("daemon:state", a);
    bus.on("daemon:state", b);
    bus.emit("daemon:state", { from: "IDLE", to: "CONNECTING" });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("emit with no subscribers is a noop", () => {
    const bus = new EventBus();
    expect(() => bus.emit("daemon:state", { from: "IDLE", to: "CONNECTING" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/unit/core/events.test.ts
```

Expected: FAIL — "Cannot find module '../../../src/core/events'".

- [ ] **Step 3: Implement `src/core/events.ts`**

```ts
import type { CapturedDownload, ExtensionSettings } from "../types";
import type { State } from "../daemon/state";

export interface Events {
  "daemon:state": { from: State; to: State; cause?: string };
  "daemon:error": { where: string; cause: unknown };
  "daemon:message": { payload: CapturedDownload };
  "send:outcome": { kind: "sent" | "fallback" | "drop"; reason?: string };
  "settings:changed": { settings: ExtensionSettings };
  "settings:applied": { url: string; interceptEnabled: boolean };
  "log:entry": { level: "debug" | "info" | "warn" | "error"; scope: string; msg: string; ctx?: Record<string, unknown> };
}

type Handler<K extends keyof Events> = (payload: Events[K]) => void;
type Unsubscribe = () => void;

export class EventBus {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(evt: K, cb: Handler<K>): Unsubscribe {
    let set = this.handlers.get(evt);
    if (!set) {
      set = new Set();
      this.handlers.set(evt, set);
    }
    set.add(cb as Handler<any>);
    return () => {
      set!.delete(cb as Handler<any>);
    };
  }

  emit<K extends keyof Events>(evt: K, payload: Events[K]): void {
    const set = this.handlers.get(evt);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch {
        // Subscriber errors are isolated; don't break other subscribers.
        // (Logger will capture via unhandled-error path later.)
      }
    }
  }
}
```

This file imports `State` from `src/daemon/state.ts` (Task 6) — circular import is fine because `State` is a type-only import.

- [ ] **Step 4: Add placeholder `State` type in `src/daemon/state.ts` to satisfy the import**

Create minimal `src/daemon/state.ts`:

```ts
export type State = "IDLE" | "CONNECTING" | "OPEN" | "RECONNECTING" | "DISABLED";
```

(Task 6 fills in the rest.)

- [ ] **Step 5: Run tests — all must pass**

```bash
npm test -- tests/unit/core/events.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/events.ts src/daemon/state.ts tests/unit/core/events.test.ts
git commit -m "feat(core): typed EventBus"
```

---

## Task 4: `core/logger.ts` — leveled logger with redaction + ring buffer

**Files:**
- Create: `src/core/logger.ts`
- Create: `tests/unit/core/logger.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/core/logger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger, redactUrl, redactContext } from "../../../src/core/logger";
import { EventBus } from "../../../src/core/events";

describe("redactUrl", () => {
  it("strips query strings", () => {
    expect(redactUrl("https://a.com/b?c=1")).toBe("https://a.com/b?…");
  });
  it("leaves clean URLs alone", () => {
    expect(redactUrl("https://a.com/b")).toBe("https://a.com/b");
  });
  it("handles invalid URLs gracefully", () => {
    expect(redactUrl("not a url")).toBe("not a url");
  });
  it("handles empty string", () => {
    expect(redactUrl("")).toBe("");
  });
});

describe("redactContext", () => {
  it("replaces cookie values with [redacted]", () => {
    const out = redactContext({ cookies: [{ Name: "x", Value: "secret" }] });
    expect(out).toEqual({ cookies: "[redacted]" });
  });
  it("redacts Authorization key", () => {
    expect(redactContext({ Authorization: "Bearer xyz" })).toEqual({ Authorization: "[redacted]" });
  });
  it("redacts Cookie header value", () => {
    expect(redactContext({ Cookie: "session=abc" })).toEqual({ Cookie: "[redacted]" });
  });
  it("is case-insensitive on sensitive keys", () => {
    expect(redactContext({ cookie: "x" })).toEqual({ cookie: "[redacted]" });
    expect(redactContext({ COOKIE: "x" })).toEqual({ COOKIE: "[redacted]" });
  });
  it("redacts urls recursively", () => {
    expect(redactContext({ url: "https://a.com/b?tok=xyz" })).toEqual({ url: "https://a.com/b?…" });
  });
  it("leaves non-sensitive values intact", () => {
    expect(redactContext({ count: 5, name: "hello" })).toEqual({ count: 5, name: "hello" });
  });
  it("handles undefined/null context", () => {
    expect(redactContext(undefined)).toBeUndefined();
  });
});

describe("Logger", () => {
  let bus: EventBus;
  let sink: string[];

  beforeEach(() => {
    bus = new EventBus();
    sink = [];
  });

  it("emits log:entry to bus for each level", () => {
    const entries: any[] = [];
    bus.on("log:entry", (e) => entries.push(e));
    const log = new Logger({ bus, writer: (line) => sink.push(line) });
    log.info("hello", { a: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: "info", scope: "root", msg: "hello" });
  });

  it("writes one line per call with scope prefix", () => {
    const log = new Logger({ bus, writer: (line) => sink.push(line), clock: () => 1234 });
    log.info("hello");
    expect(sink[0]).toContain("[root] INFO  hello");
  });

  it("child loggers inherit writer but have their own scope", () => {
    const log = new Logger({ bus, writer: (line) => sink.push(line) });
    const child = log.child("daemon");
    child.warn("x");
    expect(sink[0]).toContain("[daemon] WARN  x");
  });

  it("redacts context by default", () => {
    const log = new Logger({ bus, writer: (line) => sink.push(line) });
    log.info("test", { Cookie: "secret" });
    expect(sink[0]).toContain("[redacted]");
    expect(sink[0]).not.toContain("secret");
  });

  it("debug flag disables redaction", () => {
    const log = new Logger({ bus, writer: (line) => sink.push(line), debug: () => true });
    log.info("test", { Cookie: "secret" });
    expect(sink[0]).toContain("secret");
  });

  it("records warn+error into ring buffer", () => {
    const log = new Logger({ bus, writer: () => {}, ringSize: 3 });
    log.info("ignored");       // info does NOT go to ring
    log.warn("w1");
    log.error("e1");
    log.warn("w2");
    log.warn("w3");             // evicts w1
    const ring = log.ringBuffer();
    expect(ring.map((e) => e.msg)).toEqual(["e1", "w2", "w3"]);
  });

  it("ring buffer respects size cap", () => {
    const log = new Logger({ bus, writer: () => {}, ringSize: 2 });
    log.warn("a");
    log.warn("b");
    log.warn("c");
    expect(log.ringBuffer().map((e) => e.msg)).toEqual(["b", "c"]);
  });

  it("error() includes the error message in the log line", () => {
    const log = new Logger({ bus, writer: (l) => sink.push(l) });
    log.error("failed", {}, new Error("boom"));
    expect(sink[0]).toContain("boom");
  });

  it("handles error() with non-Error cause", () => {
    const log = new Logger({ bus, writer: (l) => sink.push(l) });
    log.error("failed", {}, "string-cause");
    expect(sink[0]).toContain("string-cause");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/unit/core/logger.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/logger.ts`**

```ts
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
```

- [ ] **Step 4: Run tests — all must pass**

```bash
npm test -- tests/unit/core/logger.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/logger.ts tests/unit/core/logger.test.ts
git commit -m "feat(core): leveled logger with redaction and ring buffer"
```

---

## Task 5: `core/container.ts` — skeleton

We add the minimal `Container` that just has a `ready` promise and placeholders for modules. Real wiring happens in Task 21. This task exists so `container.ready` is available for tests as we build up.

**Files:**
- Create: `src/core/container.ts`
- Create: `tests/unit/core/container.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { Container } from "../../../src/core/container";

describe("Container skeleton", () => {
  it("exposes a ready promise that resolves after start()", async () => {
    const c = new Container();
    let resolved = false;
    c.ready.then(() => { resolved = true; });
    expect(resolved).toBe(false);
    await c.start();
    // Microtask flush
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it("start() is idempotent — second call resolves immediately", async () => {
    const c = new Container();
    await c.start();
    await c.start();      // must not throw
    expect(c.isStarted).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/core/container.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/core/container.ts`**

```ts
import { EventBus } from "./events";
import { Logger } from "./logger";

export class Container {
  readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private started = false;

  bus!: EventBus;
  log!: Logger;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.bus = new EventBus();
    this.log = new Logger({ bus: this.bus });
    // Additional wiring is added in Task 21.
    this.started = true;
    this.readyResolve();
  }
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/core/container.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/container.ts tests/unit/core/container.test.ts
git commit -m "feat(core): DI container skeleton"
```

---

## Task 6: `daemon/state.ts` — state enum + legal transition table

**Files:**
- Modify: `src/daemon/state.ts` (we created a stub in Task 3)
- Create: `tests/unit/daemon/state.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/daemon/state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isLegalTransition, TRANSITIONS, type State } from "../../../src/daemon/state";

describe("state transitions", () => {
  it("allows IDLE → CONNECTING", () => {
    expect(isLegalTransition("IDLE", "CONNECTING")).toBe(true);
  });

  it("allows CONNECTING → OPEN", () => {
    expect(isLegalTransition("CONNECTING", "OPEN")).toBe(true);
  });

  it("allows CONNECTING → RECONNECTING", () => {
    expect(isLegalTransition("CONNECTING", "RECONNECTING")).toBe(true);
  });

  it("allows OPEN → RECONNECTING", () => {
    expect(isLegalTransition("OPEN", "RECONNECTING")).toBe(true);
  });

  it("allows RECONNECTING → CONNECTING", () => {
    expect(isLegalTransition("RECONNECTING", "CONNECTING")).toBe(true);
  });

  it("allows RECONNECTING → DISABLED", () => {
    expect(isLegalTransition("RECONNECTING", "DISABLED")).toBe(true);
  });

  it("allows DISABLED → CONNECTING", () => {
    expect(isLegalTransition("DISABLED", "CONNECTING")).toBe(true);
  });

  it("allows any state → IDLE", () => {
    const states: State[] = ["IDLE", "CONNECTING", "OPEN", "RECONNECTING", "DISABLED"];
    for (const s of states) {
      expect(isLegalTransition(s, "IDLE")).toBe(true);
    }
  });

  it("disallows IDLE → OPEN (must go through CONNECTING)", () => {
    expect(isLegalTransition("IDLE", "OPEN")).toBe(false);
  });

  it("disallows OPEN → CONNECTING (must go through RECONNECTING or IDLE)", () => {
    expect(isLegalTransition("OPEN", "CONNECTING")).toBe(false);
  });

  it("disallows self-transitions except IDLE → IDLE as stop idempotency", () => {
    expect(isLegalTransition("OPEN", "OPEN")).toBe(false);
    expect(isLegalTransition("CONNECTING", "CONNECTING")).toBe(false);
    expect(isLegalTransition("IDLE", "IDLE")).toBe(true);   // stop() on already-idle
  });

  it("disallows DISABLED → RECONNECTING directly (must resume to CONNECTING)", () => {
    expect(isLegalTransition("DISABLED", "RECONNECTING")).toBe(false);
  });

  it("TRANSITIONS is a frozen map", () => {
    expect(() => {
      (TRANSITIONS as any).IDLE = new Set();
    }).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/daemon/state.test.ts
```

Expected: FAIL — `isLegalTransition is not a function`.

- [ ] **Step 3: Replace `src/daemon/state.ts`**

```ts
export type State = "IDLE" | "CONNECTING" | "OPEN" | "RECONNECTING" | "DISABLED";

export const TRANSITIONS: Readonly<Record<State, ReadonlySet<State>>> = Object.freeze({
  IDLE:          new Set<State>(["CONNECTING", "IDLE"]),
  CONNECTING:    new Set<State>(["OPEN", "RECONNECTING", "IDLE"]),
  OPEN:          new Set<State>(["RECONNECTING", "IDLE"]),
  RECONNECTING:  new Set<State>(["CONNECTING", "DISABLED", "IDLE"]),
  DISABLED:      new Set<State>(["CONNECTING", "IDLE"]),
});

export function isLegalTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].has(to);
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/daemon/state.test.ts
```

Expected: all 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/state.ts tests/unit/daemon/state.test.ts
git commit -m "feat(daemon): state enum + legal transition table"
```

---

## Task 7: `daemon/backoff.ts` — jittered exponential backoff

**Files:**
- Create: `src/daemon/backoff.ts`
- Create: `tests/unit/daemon/backoff.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { nextDelay } from "../../../src/daemon/backoff";

describe("nextDelay", () => {
  it("first attempt is around 1000ms", () => {
    // With ±15% jitter, expect 850..1150. Sample many times.
    const values = Array.from({ length: 100 }, () => nextDelay(0));
    expect(values.every((v) => v >= 850 && v <= 1150)).toBe(true);
  });

  it("second attempt doubles to around 2000ms", () => {
    const values = Array.from({ length: 100 }, () => nextDelay(1));
    expect(values.every((v) => v >= 1700 && v <= 2300)).toBe(true);
  });

  it("capped at 30_000ms base", () => {
    const values = Array.from({ length: 100 }, () => nextDelay(10));
    expect(values.every((v) => v >= 25500 && v <= 34500)).toBe(true);
  });

  it("negative attempts still return positive delay", () => {
    const v = nextDelay(-1);
    expect(v).toBeGreaterThanOrEqual(100);
  });

  it("never returns below floor of 100ms", () => {
    for (let i = 0; i < 100; i++) {
      expect(nextDelay(0)).toBeGreaterThanOrEqual(100);
    }
  });

  it("produces varied output across calls (not deterministic)", () => {
    const samples = new Set<number>();
    for (let i = 0; i < 50; i++) samples.add(nextDelay(3));
    expect(samples.size).toBeGreaterThan(30);   // jitter actually varies
  });

  it("huge attempt values still return cap, don't overflow", () => {
    const v = nextDelay(100);
    expect(v).toBeLessThan(35_000);
    expect(v).toBeGreaterThan(25_000);
  });

  it("deterministic when Math.random is stubbed", () => {
    const orig = Math.random;
    Math.random = () => 0.5;   // pure center
    try {
      expect(nextDelay(0)).toBe(1000);
      expect(nextDelay(1)).toBe(2000);
    } finally {
      Math.random = orig;
    }
  });

  it("with Math.random=0 gives lower bound", () => {
    const orig = Math.random;
    Math.random = () => 0;
    try {
      expect(nextDelay(0)).toBe(850);   // 1000 - 15%
    } finally {
      Math.random = orig;
    }
  });

  it("with Math.random=1 (approaching) gives upper bound", () => {
    const orig = Math.random;
    Math.random = () => 0.9999999;
    try {
      const v = nextDelay(0);
      expect(v).toBeGreaterThan(1140);
      expect(v).toBeLessThanOrEqual(1150);
    } finally {
      Math.random = orig;
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/daemon/backoff.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/daemon/backoff.ts`**

```ts
const MIN_FLOOR_MS = 100;
const BASE_MS = 1000;
const CAP_MS = 30_000;
const JITTER_RATIO = 0.15;   // ±15%

export function nextDelay(attempt: number): number {
  const exp = Math.max(0, attempt);
  const base = Math.min(BASE_MS * 2 ** exp, CAP_MS);
  const jitter = (Math.random() - 0.5) * 2 * base * JITTER_RATIO;
  return Math.max(MIN_FLOOR_MS, Math.round(base + jitter));
}
```

- [ ] **Step 4: Run tests — all must pass**

```bash
npm test -- tests/unit/daemon/backoff.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/backoff.ts tests/unit/daemon/backoff.test.ts
git commit -m "feat(daemon): jittered exponential backoff"
```

---

## Task 8: `daemon/protocol.ts` — wire encoder (pure)

**Files:**
- Create: `src/daemon/protocol.ts`
- Create: `tests/unit/daemon/protocol.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { encodeCapturedDownload, encodePing } from "../../../src/daemon/protocol";

describe("encodeCapturedDownload", () => {
  it("produces JSON with url, headers, cookies", () => {
    const msg = encodeCapturedDownload({
      url: "https://a.com/file.zip",
      headers: [{ key: "User-Agent", value: "Mozilla" }],
      cookies: [],
    });
    expect(JSON.parse(msg)).toEqual({
      url: "https://a.com/file.zip",
      headers: [{ key: "User-Agent", value: "Mozilla" }],
      cookies: [],
    });
  });

  it("preserves cookie field casing (PascalCase for Go http.Cookie)", () => {
    const msg = encodeCapturedDownload({
      url: "https://a.com",
      headers: [],
      cookies: [{ Name: "s", Value: "v", Domain: ".a.com", Path: "/", HttpOnly: true, Secure: false }],
    });
    const parsed = JSON.parse(msg);
    expect(parsed.cookies[0].Name).toBe("s");
    expect(parsed.cookies[0].HttpOnly).toBe(true);
  });

  it("empty arrays serialize as []", () => {
    const msg = encodeCapturedDownload({ url: "https://a.com", headers: [], cookies: [] });
    expect(msg).toContain('"headers":[]');
    expect(msg).toContain('"cookies":[]');
  });
});

describe("encodePing", () => {
  it("produces minimal ping frame", () => {
    expect(encodePing()).toBe('{"type":"ping"}');
  });

  it("is stable across calls", () => {
    expect(encodePing()).toBe(encodePing());
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/daemon/protocol.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/daemon/protocol.ts`**

```ts
import type { CapturedDownload } from "../types";

export function encodeCapturedDownload(msg: CapturedDownload): string {
  return JSON.stringify(msg);
}

export function encodePing(): string {
  return '{"type":"ping"}';
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/daemon/protocol.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/protocol.ts tests/unit/daemon/protocol.test.ts
git commit -m "feat(daemon): wire protocol encoders"
```

---

## Task 9: `capture/url_validator.ts` — daemon URL validation

**Files:**
- Create: `src/capture/url_validator.ts`
- Create: `tests/unit/capture/url_validator.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { validateDaemonUrl } from "../../../src/capture/url_validator";

describe("validateDaemonUrl", () => {
  // Valid inputs
  it.each([
    ["localhost:3850", "localhost", 3850],
    ["127.0.0.1:3850", "127.0.0.1", 3850],
    ["[::1]:3850", "[::1]", 3850],
    ["[fe80::1]:8080", "[fe80::1]", 8080],
    ["my-server.lan:8080", "my-server.lan", 8080],
    ["my.host-name.example:1", "my.host-name.example", 1],
    ["_underscore:65535", "_underscore", 65535],
    ["192.168.1.5:3000", "192.168.1.5", 3000],
  ])("accepts valid input %s", (input, host, port) => {
    const r = validateDaemonUrl(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.host).toBe(host);
      expect(r.port).toBe(port);
    }
  });

  it("trims surrounding whitespace", () => {
    const r = validateDaemonUrl("  localhost:3850  ");
    expect(r.ok).toBe(true);
  });

  // Error branches
  it("rejects empty string", () => {
    const r = validateDaemonUrl("");
    expect(r).toEqual({ ok: false, error: "empty" });
  });

  it("rejects only whitespace", () => {
    const r = validateDaemonUrl("   ");
    expect(r).toEqual({ ok: false, error: "empty" });
  });

  it("rejects ws:// scheme", () => {
    const r = validateDaemonUrl("ws://host:3850");
    expect(r).toEqual({ ok: false, error: "contains_scheme" });
  });

  it("rejects http:// scheme", () => {
    const r = validateDaemonUrl("http://host:3850");
    expect(r).toEqual({ ok: false, error: "contains_scheme" });
  });

  it("rejects wss:// scheme", () => {
    const r = validateDaemonUrl("wss://host:3850");
    expect(r).toEqual({ ok: false, error: "contains_scheme" });
  });

  it("rejects paths", () => {
    expect(validateDaemonUrl("host:3850/")).toEqual({ ok: false, error: "contains_path" });
    expect(validateDaemonUrl("host:3850/foo")).toEqual({ ok: false, error: "contains_path" });
  });

  it("rejects missing port — bare host", () => {
    expect(validateDaemonUrl("localhost")).toEqual({ ok: false, error: "missing_port" });
  });

  it("rejects trailing colon no port", () => {
    expect(validateDaemonUrl("host:")).toEqual({ ok: false, error: "missing_port" });
  });

  it("rejects port 0", () => {
    expect(validateDaemonUrl("host:0")).toEqual({ ok: false, error: "port_out_of_range" });
  });

  it("rejects port 65536", () => {
    expect(validateDaemonUrl("host:65536")).toEqual({ ok: false, error: "port_out_of_range" });
  });

  it("rejects non-numeric port", () => {
    expect(validateDaemonUrl("host:abc")).toEqual({ ok: false, error: "port_out_of_range" });
  });

  it("rejects port with extra chars", () => {
    expect(validateDaemonUrl("host:3850abc")).toEqual({ ok: false, error: "port_out_of_range" });
  });

  it("rejects invalid host chars (space)", () => {
    expect(validateDaemonUrl("ho st:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });

  it("rejects invalid host chars (pipe)", () => {
    expect(validateDaemonUrl("a|b:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });

  it("rejects IPv6 without brackets", () => {
    expect(validateDaemonUrl("fe80::1:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });

  it("rejects over-long input (length overflow)", () => {
    const r = validateDaemonUrl("a".repeat(254) + ":80");
    expect(r).toEqual({ ok: false, error: "too_long" });
  });

  it("completes quickly on 10000-char input (no ReDoS)", () => {
    const start = Date.now();
    validateDaemonUrl("a".repeat(10_000));
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("rejects missing host — starts with colon", () => {
    expect(validateDaemonUrl(":3850")).toEqual({ ok: false, error: "malformed" });
  });

  it("rejects IPv6 with unmatched bracket", () => {
    expect(validateDaemonUrl("[fe80::1:3850")).toEqual({ ok: false, error: "malformed" });
  });

  it("rejects IPv6 with port but malformed brackets", () => {
    expect(validateDaemonUrl("[fe80::1]")).toEqual({ ok: false, error: "missing_port" });
  });

  it("rejects control characters in host", () => {
    expect(validateDaemonUrl("host\n:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });

  it("rejects multiple colons in IPv4-style input", () => {
    expect(validateDaemonUrl("a:b:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/capture/url_validator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/capture/url_validator.ts`**

```ts
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
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/capture/url_validator.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capture/url_validator.ts tests/unit/capture/url_validator.test.ts
git commit -m "feat(capture): daemon URL syntax validator"
```

---

## Task 10: `capture/cookie_mapper.ts` — Chrome cookie → daemon cookie

**Files:**
- Create: `src/capture/cookie_mapper.ts`
- Create: `tests/unit/capture/cookie_mapper.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { toDaemonCookie } from "../../../src/capture/cookie_mapper";

const base = {
  name: "s",
  value: "v",
  domain: ".a.com",
  path: "/",
  secure: false,
  httpOnly: false,
  hostOnly: false,
  session: false,
  storeId: "0",
};

describe("toDaemonCookie", () => {
  it("maps basic fields with PascalCase field names", () => {
    const out = toDaemonCookie(base as chrome.cookies.Cookie);
    expect(out).toMatchObject({ Name: "s", Value: "v", Domain: ".a.com", Path: "/", Secure: false, HttpOnly: false });
  });

  it("maps expirationDate (seconds) to ISO string", () => {
    const out = toDaemonCookie({ ...base, expirationDate: 1700000000 } as chrome.cookies.Cookie);
    expect(out.Expires).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("omits Expires when expirationDate is absent", () => {
    const out = toDaemonCookie(base as chrome.cookies.Cookie);
    expect("Expires" in out).toBe(false);
  });

  it.each([
    ["lax", 1],
    ["strict", 2],
    ["no_restriction", 3],
  ])("maps sameSite=%s to %d", (sameSite, expected) => {
    const out = toDaemonCookie({ ...base, sameSite } as chrome.cookies.Cookie);
    expect(out.SameSite).toBe(expected);
  });

  it("omits SameSite when unspecified", () => {
    const out = toDaemonCookie({ ...base, sameSite: "unspecified" } as chrome.cookies.Cookie);
    expect("SameSite" in out).toBe(false);
  });

  it("preserves secure and httpOnly booleans", () => {
    const out = toDaemonCookie({ ...base, secure: true, httpOnly: true } as chrome.cookies.Cookie);
    expect(out.Secure).toBe(true);
    expect(out.HttpOnly).toBe(true);
  });

  it("preserves unicode values round-trip", () => {
    const out = toDaemonCookie({ ...base, value: "café\u{1F4A9}" } as chrome.cookies.Cookie);
    expect(out.Value).toBe("café\u{1F4A9}");
  });

  it("handles empty value string", () => {
    const out = toDaemonCookie({ ...base, value: "" } as chrome.cookies.Cookie);
    expect(out.Value).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/capture/cookie_mapper.test.ts
```

- [ ] **Step 3: Implement `src/capture/cookie_mapper.ts`**

```ts
import type { DaemonCookie } from "../types";

export function toDaemonCookie(c: chrome.cookies.Cookie): DaemonCookie {
  const out: DaemonCookie = {
    Name: c.name,
    Value: c.value,
    Domain: c.domain,
    Path: c.path,
    HttpOnly: c.httpOnly,
    Secure: c.secure,
  };
  if (c.expirationDate !== undefined) {
    out.Expires = new Date(c.expirationDate * 1000).toISOString();
  }
  switch (c.sameSite) {
    case "lax": out.SameSite = 1; break;
    case "strict": out.SameSite = 2; break;
    case "no_restriction": out.SameSite = 3; break;
    // "unspecified" or undefined → omit
  }
  return out;
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/capture/cookie_mapper.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/capture/cookie_mapper.ts tests/unit/capture/cookie_mapper.test.ts
git commit -m "feat(capture): chrome cookie → daemon cookie mapper"
```

---

## Task 11: `capture/sanitize_filename.ts` — filename sanitizer

**Files:**
- Create: `src/capture/sanitize_filename.ts`
- Create: `tests/unit/capture/sanitize_filename.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../../../src/capture/sanitize_filename";

describe("sanitizeFilename", () => {
  it("passes clean names through", () => {
    expect(sanitizeFilename("hello.mp4")).toBe("hello.mp4");
  });

  it("replaces path separators", () => {
    expect(sanitizeFilename("foo/bar.mp4")).toBe("foo_bar.mp4");
    expect(sanitizeFilename("foo\\bar.mp4")).toBe("foo_bar.mp4");
  });

  it("strips control characters", () => {
    expect(sanitizeFilename("a\x00b.mp4")).toBe("a_b.mp4");
    expect(sanitizeFilename("a\x1fb.mp4")).toBe("a_b.mp4");
  });

  it("replaces reserved Windows chars", () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*.mp4')).toBe("a_b_c_d_e_f_g_.mp4");
  });

  it("caps length at 200 characters", () => {
    const long = "a".repeat(500) + ".mp4";
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".mp4")).toBe(true);
  });

  it("preserves extension when truncating long names", () => {
    const long = "a".repeat(300) + ".webm";
    const out = sanitizeFilename(long);
    expect(out.endsWith(".webm")).toBe(true);
  });

  it("handles unicode characters", () => {
    expect(sanitizeFilename("cafe\u{1F4A9}.mp4")).toBe("cafe\u{1F4A9}.mp4");
  });

  it("rejects empty input with fallback", () => {
    expect(sanitizeFilename("")).toBe("download");
  });

  it("replaces all whitespace-only input with fallback", () => {
    expect(sanitizeFilename("   ")).toBe("download");
  });

  it("strips leading/trailing dots (Windows hostile)", () => {
    expect(sanitizeFilename(".hidden.mp4.")).toBe("hidden.mp4");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/capture/sanitize_filename.test.ts
```

- [ ] **Step 3: Implement `src/capture/sanitize_filename.ts`**

```ts
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
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/capture/sanitize_filename.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/capture/sanitize_filename.ts tests/unit/capture/sanitize_filename.test.ts
git commit -m "feat(capture): centralized filename sanitizer"
```

---

## Task 12: `capture/header_store.ts` — TTL + LRU header cache

**Files:**
- Create: `src/capture/header_store.ts`
- Create: `tests/unit/capture/header_store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { HeaderStore } from "../../../src/capture/header_store";
import { FakeClock } from "../../fixtures/fake_clock";

function mkHeaders(n: number): { name: string; value: string }[] {
  return Array.from({ length: n }, (_, i) => ({ name: `H${i}`, value: `v${i}` }));
}

describe("HeaderStore", () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock();
  });

  it("set/get round-trip", () => {
    const store = new HeaderStore({ clock });
    const h = mkHeaders(2);
    store.set("https://a.com", h);
    expect(store.get("https://a.com")).toEqual(h);
  });

  it("get returns undefined for unknown url", () => {
    const store = new HeaderStore({ clock });
    expect(store.get("https://nothing.com")).toBeUndefined();
  });

  it("delete removes entry", () => {
    const store = new HeaderStore({ clock });
    store.set("u", mkHeaders(1));
    store.delete("u");
    expect(store.get("u")).toBeUndefined();
  });

  it("entry expires after TTL", () => {
    const store = new HeaderStore({ clock, ttlMs: 60_000 });
    store.set("u", mkHeaders(1));
    clock.tick(59_999);
    expect(store.get("u")).toBeDefined();
    clock.tick(2);
    expect(store.get("u")).toBeUndefined();
  });

  it("get removes expired entry as a side effect", () => {
    const store = new HeaderStore({ clock, ttlMs: 1000 });
    store.set("u", mkHeaders(1));
    clock.tick(2000);
    store.get("u");   // triggers lazy delete
    expect(store.size()).toBe(0);
  });

  it("migrate moves entry from old url to new url", () => {
    const store = new HeaderStore({ clock });
    store.set("old", mkHeaders(1));
    store.migrate("old", "new");
    expect(store.get("old")).toBeUndefined();
    expect(store.get("new")).toBeDefined();
  });

  it("migrate with missing old url is a noop", () => {
    const store = new HeaderStore({ clock });
    expect(() => store.migrate("missing", "new")).not.toThrow();
    expect(store.get("new")).toBeUndefined();
  });

  it("LRU eviction at cap", () => {
    const store = new HeaderStore({ clock, cap: 3 });
    store.set("a", mkHeaders(1));
    store.set("b", mkHeaders(1));
    store.set("c", mkHeaders(1));
    store.set("d", mkHeaders(1));   // evicts "a"
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toBeDefined();
    expect(store.get("c")).toBeDefined();
    expect(store.get("d")).toBeDefined();
  });

  it("get bumps LRU recency", () => {
    const store = new HeaderStore({ clock, cap: 3 });
    store.set("a", mkHeaders(1));
    store.set("b", mkHeaders(1));
    store.set("c", mkHeaders(1));
    store.get("a");                  // bump "a" to most-recent
    store.set("d", mkHeaders(1));    // evicts "b" (now LRU)
    expect(store.get("a")).toBeDefined();
    expect(store.get("b")).toBeUndefined();
    expect(store.get("c")).toBeDefined();
  });

  it("startSweep removes expired entries via timer", () => {
    const store = new HeaderStore({ clock, ttlMs: 1000, sweepMs: 500 });
    store.set("u", mkHeaders(1));
    store.startSweep();
    clock.tick(1500);   // past TTL; sweep fires 3 times
    expect(store.size()).toBe(0);
  });

  it("stopSweep halts the sweep timer", () => {
    const store = new HeaderStore({ clock, ttlMs: 1000, sweepMs: 500 });
    store.startSweep();
    store.stopSweep();
    store.set("u", mkHeaders(1));
    clock.tick(5000);
    expect(store.size()).toBe(1);   // no sweep happened
  });

  it("re-set on existing key updates TTL and bumps LRU", () => {
    const store = new HeaderStore({ clock, ttlMs: 1000 });
    store.set("u", mkHeaders(1));
    clock.tick(800);
    store.set("u", mkHeaders(2));   // reset TTL
    clock.tick(800);                 // 1600 since first set, 800 since second
    expect(store.get("u")).toBeDefined();
    expect(store.get("u")).toHaveLength(2);
  });

  it("size returns count of active entries only", () => {
    const store = new HeaderStore({ clock, ttlMs: 1000 });
    store.set("a", mkHeaders(1));
    store.set("b", mkHeaders(1));
    clock.tick(2000);
    // Both are expired but not swept yet — size returns raw internal count
    // until we explicitly sweep or lazily evict via get().
    expect(store.size()).toBe(2);
    store.sweep();
    expect(store.size()).toBe(0);
  });

  it("handles many entries without slowdown (sanity perf)", () => {
    const store = new HeaderStore({ clock, cap: 1000 });
    for (let i = 0; i < 1000; i++) store.set(`u${i}`, mkHeaders(1));
    const start = Date.now();
    for (let i = 0; i < 100; i++) store.set(`x${i}`, mkHeaders(1));
    expect(Date.now() - start).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/capture/header_store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/capture/header_store.ts`**

```ts
import type { Clock } from "../../tests/fixtures/fake_clock";

// NOTE: we don't import Clock from tests/. Re-declare it for production code.
// Tests pass a compatible shape.

interface ClockLike {
  now(): number;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface CapturedHeader {
  name: string;
  value: string | undefined;
}

interface Entry {
  headers: CapturedHeader[];
  expiresAt: number;
}

interface Opts {
  clock: ClockLike;
  ttlMs?: number;
  sweepMs?: number;
  cap?: number;
}

export class HeaderStore {
  private map = new Map<string, Entry>();
  private clock: ClockLike;
  private ttlMs: number;
  private sweepMs: number;
  private cap: number;
  private sweepTimer: number | null = null;

  constructor(opts: Opts) {
    this.clock = opts.clock;
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.sweepMs = opts.sweepMs ?? 30_000;
    this.cap = opts.cap ?? 1000;
  }

  set(url: string, headers: CapturedHeader[]): void {
    if (this.map.has(url)) this.map.delete(url);    // re-insert to move to end (LRU tail = most recent)
    this.map.set(url, { headers, expiresAt: this.clock.now() + this.ttlMs });
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get(url: string): CapturedHeader[] | undefined {
    const e = this.map.get(url);
    if (!e) return undefined;
    if (e.expiresAt <= this.clock.now()) {
      this.map.delete(url);
      return undefined;
    }
    // LRU bump
    this.map.delete(url);
    this.map.set(url, e);
    return e.headers;
  }

  delete(url: string): void {
    this.map.delete(url);
  }

  migrate(oldUrl: string, newUrl: string): void {
    const e = this.map.get(oldUrl);
    if (!e) return;
    this.map.delete(oldUrl);
    this.map.set(newUrl, e);
  }

  size(): number {
    return this.map.size;
  }

  sweep(): void {
    const now = this.clock.now();
    for (const [url, e] of this.map) {
      if (e.expiresAt <= now) this.map.delete(url);
    }
  }

  startSweep(): void {
    if (this.sweepTimer !== null) return;
    this.sweepTimer = this.clock.setInterval(() => this.sweep(), this.sweepMs);
  }

  stopSweep(): void {
    if (this.sweepTimer !== null) {
      this.clock.clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
```

**Note on Clock import:** production code should not import from `tests/`. The `ClockLike` interface duplicated here is intentional — it's the public contract. We later extract it to `src/core/clock.ts` in Task 13 if multiple modules need it. For now, inline is fine.

- [ ] **Step 4: Run tests — all must pass**

```bash
npm test -- tests/unit/capture/header_store.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capture/header_store.ts tests/unit/capture/header_store.test.ts
git commit -m "feat(capture): TTL + LRU header store with periodic sweep"
```

---

## Task 13: `core/clock.ts` + `daemon/client.ts` — state machine core (part 1 of 3)

This task builds the DaemonClient with only state transitions — no heartbeat, no circuit breaker yet. Those come in Tasks 14–15.

**Files:**
- Create: `src/core/clock.ts`
- Create: `src/daemon/client.ts`
- Create: `tests/unit/daemon/client_transitions.test.ts`

- [ ] **Step 1: Extract `ClockLike` into shared location**

Create `src/core/clock.ts`:

```ts
export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms) as unknown as number,
  clearInterval: (id) => globalThis.clearInterval(id),
};
```

Update `src/capture/header_store.ts` to import `Clock` from `src/core/clock.ts` instead of re-declaring:

```ts
// at top of file, replace the ClockLike block with:
import type { Clock } from "../core/clock";
```

And change `ClockLike` → `Clock` throughout the file.

Run the existing header_store tests to make sure nothing broke:

```bash
npm test -- tests/unit/capture/header_store.test.ts
```

Expected: still all PASS.

- [ ] **Step 2: Write failing tests for state transitions**

Create `tests/unit/daemon/client_transitions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DaemonClient } from "../../../src/daemon/client";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";
import { FakeClock } from "../../fixtures/fake_clock";
import { makeWsFactory, FakeWebSocket } from "../../fixtures/fake_websocket";

function makeClient(urlArg = "localhost:3850") {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const clock = new FakeClock();
  const { factory, lastSocket } = makeWsFactory();
  const client = new DaemonClient({
    bus,
    log,
    clock,
    wsFactory: factory as unknown as (u: string) => WebSocket,
    disableHeartbeat: true,
    disableBreaker: true,
  });
  client.setUrl(urlArg);
  return { bus, log, clock, client, lastSocket };
}

describe("DaemonClient transitions", () => {
  it("starts in IDLE", () => {
    const { client } = makeClient();
    expect(client.state).toBe("IDLE");
  });

  it("start() → CONNECTING", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    expect(client.state).toBe("CONNECTING");
    expect(lastSocket()).not.toBeNull();
  });

  it("CONNECTING → OPEN on ws.onopen", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    expect(client.state).toBe("OPEN");
  });

  it("CONNECTING → RECONNECTING on ws.onerror", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateError();
    lastSocket()!.simulateClose();   // usually error is followed by close
    expect(client.state).toBe("RECONNECTING");
  });

  it("CONNECTING → RECONNECTING on ws.onclose before open", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateClose();
    expect(client.state).toBe("RECONNECTING");
  });

  it("OPEN → RECONNECTING on ws.onclose", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    lastSocket()!.simulateClose();
    expect(client.state).toBe("RECONNECTING");
  });

  it("RECONNECTING → CONNECTING when backoff fires", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateClose();
    expect(client.state).toBe("RECONNECTING");
    clock.tick(5000);   // well past 1s jittered backoff
    expect(client.state).toBe("CONNECTING");
  });

  it("stop() from any state returns to IDLE", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    client.stop();
    expect(client.state).toBe("IDLE");
  });

  it("stop() cancels pending reconnect timer", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateClose();
    expect(client.state).toBe("RECONNECTING");
    client.stop();
    clock.tick(10_000);
    expect(client.state).toBe("IDLE");   // no auto-reconnect after stop
  });

  it("setUrl() with new value while OPEN tears down and reconnects", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    client.setUrl("otherhost:9999");
    expect(client.state).toBe("CONNECTING");
    expect(lastSocket()!.url).toContain("otherhost:9999");
  });

  it("setUrl() with same value is a noop", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    const before = lastSocket();
    client.setUrl("localhost:3850");
    expect(lastSocket()).toBe(before);
    expect(client.state).toBe("OPEN");
  });

  it("setUrl() with invalid URL transitions to DISABLED", () => {
    const { client } = makeClient();
    client.start();
    client.setUrl("not a valid url");
    expect(client.state).toBe("DISABLED");
  });

  it("resume() from DISABLED → CONNECTING", () => {
    const { client } = makeClient();
    client.start();
    client.setUrl("bad url");
    expect(client.state).toBe("DISABLED");
    client.setUrl("goodhost:3850");   // valid url resumes
    expect(client.state).toBe("CONNECTING");
  });

  it("double start() is idempotent", () => {
    const { client } = makeClient();
    client.start();
    const stateA = client.state;
    client.start();
    expect(client.state).toBe(stateA);
  });

  it("emits daemon:state on every transition", () => {
    const { client, bus, lastSocket } = makeClient();
    const events: any[] = [];
    bus.on("daemon:state", (e) => events.push(e));
    client.start();
    lastSocket()!.simulateOpen();
    lastSocket()!.simulateClose();
    expect(events.map((e) => [e.from, e.to])).toEqual([
      ["IDLE", "CONNECTING"],
      ["CONNECTING", "OPEN"],
      ["OPEN", "RECONNECTING"],
    ]);
  });

  it("send() returns {ok:false, reason:'idle'} when IDLE", () => {
    const { client } = makeClient();
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: false, reason: "idle" });
  });

  it("send() returns {ok:false, reason:'connecting'} when CONNECTING", () => {
    const { client } = makeClient();
    client.start();
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: false, reason: "connecting" });
  });

  it("send() returns {ok:true} when OPEN and calls socket.send()", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: true });
    expect(lastSocket()!.send).toHaveBeenCalled();
  });

  it("send() returns {ok:false, reason:'disabled'} when DISABLED", () => {
    const { client } = makeClient();
    client.start();
    client.setUrl("bad");
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: false, reason: "disabled" });
  });

  it("send() throwing inside socket.send returns connection_lost and transitions", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    lastSocket()!.send = vi.fn(() => { throw new Error("closed"); }) as any;
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: false, reason: "connection_lost" });
    expect(client.state).toBe("RECONNECTING");
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- tests/unit/daemon/client_transitions.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/daemon/client.ts` (state machine core only)**

```ts
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
      this.transition("DISABLED", `invalid_url:${v.error}`);
      return;
    }
    const normalized = `${v.host}:${v.port}`;
    if (this._url === normalized && (this._state === "OPEN" || this._state === "CONNECTING")) {
      return;   // no change
    }
    this._url = normalized;
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
      this.log.warn("send_failed", {}, e);
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
      this.log.warn("ws_construct_failed", {}, e);
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
    this.socket = null;
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
```

- [ ] **Step 5: Run tests — all must pass**

```bash
npm test -- tests/unit/daemon/client_transitions.test.ts
```

Expected: all ~20 tests PASS. Also re-run header_store tests to confirm Clock refactor didn't break:

```bash
npm test -- tests/unit/capture/header_store.test.ts
```

Expected: still all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/clock.ts src/daemon/client.ts src/capture/header_store.ts tests/unit/daemon/client_transitions.test.ts
git commit -m "feat(daemon): DaemonClient state machine core (no heartbeat/breaker yet)"
```

---

## Task 14: `DaemonClient` — heartbeat

We extend `DaemonClient` with the application-level heartbeat + `bufferedAmount` watcher. The test file for heartbeat is separate for focus.

**Files:**
- Modify: `src/daemon/client.ts`
- Create: `tests/unit/daemon/client_heartbeat.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { DaemonClient } from "../../../src/daemon/client";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";
import { FakeClock } from "../../fixtures/fake_clock";
import { makeWsFactory } from "../../fixtures/fake_websocket";

function makeClient() {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const clock = new FakeClock();
  const { factory, lastSocket } = makeWsFactory();
  const client = new DaemonClient({
    bus,
    log,
    clock,
    wsFactory: factory as unknown as (u: string) => WebSocket,
    heartbeatMs: 20_000,
    disableBreaker: true,
  });
  client.setUrl("h:1");
  return { client, lastSocket, clock };
}

describe("DaemonClient heartbeat", () => {
  it("sends a ping frame every heartbeatMs while OPEN", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    clock.tick(20_000);
    const sendMock = lastSocket()!.send;
    expect(sendMock).toHaveBeenCalledWith('{"type":"ping"}');
    clock.tick(20_000);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("does not send pings when not OPEN", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    clock.tick(60_000);
    expect(lastSocket()!.send).not.toHaveBeenCalled();
  });

  it("stops sending pings after leaving OPEN", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    clock.tick(20_000);
    lastSocket()!.simulateClose();
    const before = lastSocket()!.send.mock.calls.length;
    clock.tick(60_000);
    // No new sends on the closed socket.
    expect(lastSocket()!.send.mock.calls.length).toBe(before);
  });

  it("transitions to RECONNECTING when bufferedAmount stays >0 across two ticks", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    const ws = lastSocket()!;
    ws.simulateOpen();
    ws.bufferedAmount = 1024;
    clock.tick(20_000);   // first tick: capture buffered
    clock.tick(20_000);   // second tick: still >0 → force-close
    expect(client.state).toBe("RECONNECTING");
  });

  it("does NOT transition when bufferedAmount drains before second tick", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    const ws = lastSocket()!;
    ws.simulateOpen();
    ws.bufferedAmount = 1024;
    clock.tick(20_000);   // first tick: buffered
    ws.bufferedAmount = 0;
    clock.tick(20_000);   // second tick: drained
    expect(client.state).toBe("OPEN");
  });

  it("heartbeat disabled via option does nothing", () => {
    const bus = new EventBus();
    const log = new Logger({ bus, writer: () => {} });
    const clock = new FakeClock();
    const { factory, lastSocket } = makeWsFactory();
    const client = new DaemonClient({
      bus, log, clock,
      wsFactory: factory as unknown as (u: string) => WebSocket,
      disableHeartbeat: true,
      disableBreaker: true,
    });
    client.setUrl("h:1");
    client.start();
    lastSocket()!.simulateOpen();
    clock.tick(60_000);
    expect(lastSocket()!.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/daemon/client_heartbeat.test.ts
```

Expected: most tests FAIL.

- [ ] **Step 3: Extend `src/daemon/client.ts` — add heartbeat**

Add these fields to the class:

```ts
private heartbeatEnabled: boolean;
private heartbeatMs: number;
private heartbeatTimer: number | null = null;
private prevBufferedAmount = 0;
```

Update the constructor to set them:

```ts
this.heartbeatEnabled = !(deps.disableHeartbeat ?? false);
this.heartbeatMs = deps.heartbeatMs ?? 20_000;
```

Update `onEnter` for OPEN and add heartbeat helpers:

```ts
private onEnter(state: State, cause?: string): void {
  switch (state) {
    case "CONNECTING": this.openSocket(); break;
    case "OPEN":
      this.consecutiveFailures = 0;
      this.startHeartbeat();
      break;
    case "RECONNECTING":
      this.stopHeartbeat();
      this.scheduleReconnect(cause);
      break;
    case "DISABLED":
      this.stopHeartbeat();
      this.teardown();
      break;
    case "IDLE":
      this.stopHeartbeat();
      break;
  }
}

private startHeartbeat(): void {
  if (!this.heartbeatEnabled) return;
  this.prevBufferedAmount = 0;
  this.heartbeatTimer = this.clock.setInterval(() => this.heartbeatTick(), this.heartbeatMs);
}

private stopHeartbeat(): void {
  if (this.heartbeatTimer !== null) {
    this.clock.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

private heartbeatTick(): void {
  if (this._state !== "OPEN" || this.socket === null) return;
  const buf = this.socket.bufferedAmount;
  if (buf > 0 && this.prevBufferedAmount > 0) {
    this.log.warn("heartbeat_stalled", { buffered: buf });
    try { this.socket.close(); } catch { /* noop */ }
    this.transition("RECONNECTING", "heartbeat_stalled");
    return;
  }
  this.prevBufferedAmount = buf;
  try {
    this.socket.send('{"type":"ping"}');
  } catch (e) {
    this.log.warn("heartbeat_send_failed", {}, e);
    this.transition("RECONNECTING", "heartbeat_send_throw");
  }
}
```

Also make sure `teardown()` stops the heartbeat (update):

```ts
private teardown(): void {
  this.stopHeartbeat();
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
```

- [ ] **Step 4: Run heartbeat tests — must pass**

```bash
npm test -- tests/unit/daemon/client_heartbeat.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Run transition tests — must still pass**

```bash
npm test -- tests/unit/daemon/client_transitions.test.ts
```

Expected: still all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/client.ts tests/unit/daemon/client_heartbeat.test.ts
git commit -m "feat(daemon): application-level heartbeat with bufferedAmount stall detection"
```

---

## Task 15: `DaemonClient` — circuit breaker

**Files:**
- Modify: `src/daemon/client.ts` (breaker logic is already present but disabled by `disableBreaker` in earlier tests — we add focused tests now)
- Create: `tests/unit/daemon/client_breaker.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { DaemonClient } from "../../../src/daemon/client";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";
import { FakeClock } from "../../fixtures/fake_clock";
import { makeWsFactory } from "../../fixtures/fake_websocket";

function makeClient(threshold = 3) {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const clock = new FakeClock();
  const { factory, lastSocket } = makeWsFactory();
  const client = new DaemonClient({
    bus, log, clock,
    wsFactory: factory as unknown as (u: string) => WebSocket,
    disableHeartbeat: true,
    breakerThreshold: threshold,
  });
  client.setUrl("h:1");
  return { client, lastSocket, clock, bus };
}

describe("DaemonClient circuit breaker", () => {
  it("trips to DISABLED after threshold consecutive failures", () => {
    const { client, lastSocket, clock } = makeClient(3);
    client.start();
    for (let i = 0; i < 3; i++) {
      lastSocket()!.simulateClose();
      clock.tick(60_000);
    }
    expect(client.state).toBe("DISABLED");
  });

  it("successful open resets failure counter", () => {
    const { client, lastSocket, clock } = makeClient(3);
    client.start();
    lastSocket()!.simulateClose();           // fail 1
    clock.tick(60_000);                       // → CONNECTING
    lastSocket()!.simulateClose();           // fail 2
    clock.tick(60_000);                       // → CONNECTING
    lastSocket()!.simulateOpen();            // reset
    lastSocket()!.simulateClose();           // fail 1 again
    clock.tick(60_000);
    lastSocket()!.simulateClose();           // fail 2
    clock.tick(60_000);
    expect(client.state).not.toBe("DISABLED");
  });

  it("resume() from DISABLED transitions to CONNECTING", () => {
    const { client, lastSocket, clock } = makeClient(2);
    client.start();
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    expect(client.state).toBe("DISABLED");
    client.resume();
    expect(client.state).toBe("CONNECTING");
  });

  it("setUrl() with new value exits DISABLED", () => {
    const { client, lastSocket, clock } = makeClient(2);
    client.start();
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    expect(client.state).toBe("DISABLED");
    client.setUrl("other:2");
    expect(client.state).toBe("CONNECTING");
  });

  it("breaker emits state transition to DISABLED with cause breaker_tripped", () => {
    const { client, bus, lastSocket, clock } = makeClient(1);
    const events: any[] = [];
    bus.on("daemon:state", (e) => events.push(e));
    client.start();
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    const disabled = events.find((e) => e.to === "DISABLED");
    expect(disabled?.cause).toBe("breaker_tripped");
  });

  it("DISABLED state tears down socket", () => {
    const { client, lastSocket, clock } = makeClient(1);
    client.start();
    const ws = lastSocket()!;
    ws.simulateClose();
    clock.tick(60_000);
    expect(client.state).toBe("DISABLED");
    expect(ws.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/unit/daemon/client_breaker.test.ts
```

Expected: PASS if breaker logic is already present from Task 13. If any fail, patch `DaemonClient` to match expectations and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/daemon/client_breaker.test.ts
git commit -m "test(daemon): circuit breaker edge cases"
```

---

## Task 16: `downloads/send_or_fallback.ts` — unified decision helper

**Files:**
- Create: `src/downloads/send_or_fallback.ts`
- Create: `tests/unit/downloads/send_or_fallback.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { sendOrFallback } from "../../../src/downloads/send_or_fallback";
import type { DaemonClient } from "../../../src/daemon/client";

function mkClient(state: string, sendOk = true) {
  return {
    state,
    send: vi.fn(() => sendOk ? { ok: true } : { ok: false, reason: "connection_lost" }),
  } as unknown as DaemonClient;
}

describe("sendOrFallback", () => {
  it("returns {kind:sent} when daemon is OPEN and send ok", async () => {
    const client = mkClient("OPEN", true);
    const r = await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, { onFallback: vi.fn() });
    expect(r).toEqual({ kind: "sent" });
    expect(client.send).toHaveBeenCalled();
  });

  it("calls onFallback when daemon is not OPEN", async () => {
    const client = mkClient("RECONNECTING");
    const onFallback = vi.fn();
    const r = await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, { onFallback });
    expect(r).toEqual({ kind: "fallback", reason: "reconnecting" });
    expect(client.send).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith({ reason: "reconnecting" });
  });

  it("calls onFallback when send fails", async () => {
    const client = mkClient("OPEN", false);
    const onFallback = vi.fn();
    const r = await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, { onFallback });
    expect(r).toEqual({ kind: "fallback", reason: "connection_lost" });
    expect(onFallback).toHaveBeenCalled();
  });

  it("works with onFallback=undefined (decision-only mode)", async () => {
    const client = mkClient("IDLE");
    const r = await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, {});
    expect(r).toEqual({ kind: "fallback", reason: "idle" });
  });

  it("onFallback can be async and is awaited", async () => {
    const client = mkClient("IDLE");
    const calls: string[] = [];
    const onFallback = async () => {
      calls.push("start");
      await new Promise((r) => setTimeout(r, 1));
      calls.push("end");
    };
    await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, { onFallback });
    expect(calls).toEqual(["start", "end"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/downloads/send_or_fallback.test.ts
```

- [ ] **Step 3: Implement `src/downloads/send_or_fallback.ts`**

```ts
import type { DaemonClient, SendResult } from "../daemon/client";
import type { CapturedDownload } from "../types";

export type SendOrFallbackResult =
  | { kind: "sent" }
  | { kind: "fallback"; reason: string };

interface Opts {
  onFallback?: (info: { reason: string }) => void | Promise<void>;
}

export async function sendOrFallback(
  client: DaemonClient,
  msg: CapturedDownload,
  opts: Opts
): Promise<SendOrFallbackResult> {
  if (client.state !== "OPEN") {
    const reason = mapStateToReason(client.state);
    if (opts.onFallback) await opts.onFallback({ reason });
    return { kind: "fallback", reason };
  }
  const r: SendResult = client.send(msg);
  if (r.ok) return { kind: "sent" };
  if (opts.onFallback) await opts.onFallback({ reason: r.reason });
  return { kind: "fallback", reason: r.reason };
}

function mapStateToReason(state: string): string {
  switch (state) {
    case "IDLE": return "idle";
    case "CONNECTING": return "connecting";
    case "RECONNECTING": return "reconnecting";
    case "DISABLED": return "disabled";
    default: return "unknown";
  }
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/downloads/send_or_fallback.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/downloads/send_or_fallback.ts tests/unit/downloads/send_or_fallback.test.ts
git commit -m "feat(downloads): send-or-fallback decision helper"
```

---

## Task 17: `downloads/interceptor.ts` — chrome.downloads.onCreated handler

**Files:**
- Create: `src/downloads/interceptor.ts`
- Create: `tests/unit/downloads/interceptor.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DownloadInterceptor } from "../../../src/downloads/interceptor";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";
import { HeaderStore } from "../../../src/capture/header_store";
import { FakeClock } from "../../fixtures/fake_clock";

function makeInterceptor(opts: {
  state?: string;
  sendOk?: boolean;
  interceptEnabled?: boolean;
}) {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const clock = new FakeClock();
  const headerStore = new HeaderStore({ clock });
  const daemon = {
    state: opts.state ?? "OPEN",
    send: vi.fn(() => opts.sendOk ?? true ? { ok: true } : { ok: false, reason: "connection_lost" }),
  } as any;
  const getSettings = () => ({ daemonUrl: "h:1", interceptDownloads: opts.interceptEnabled ?? true });
  const interceptor = new DownloadInterceptor({ bus, log, daemon, headerStore, getSettings });
  return { interceptor, daemon, bus, headerStore };
}

describe("DownloadInterceptor", () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      cookies: { getAll: vi.fn(async () => []) },
      downloads: { cancel: vi.fn(async () => undefined), erase: vi.fn(async () => undefined) },
    };
  });

  it("skips when interceptEnabled is false", async () => {
    const { interceptor, daemon } = makeInterceptor({ interceptEnabled: false });
    await interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    expect(daemon.send).not.toHaveBeenCalled();
    expect((globalThis as any).chrome.downloads.cancel).not.toHaveBeenCalled();
  });

  it("skips non-HTTP URLs", async () => {
    const { interceptor, daemon } = makeInterceptor({});
    await interceptor.handle({ id: 1, url: "blob:https://a.com/x" });
    expect(daemon.send).not.toHaveBeenCalled();
  });

  it("skips when daemon not OPEN (browser continues)", async () => {
    const { interceptor, daemon } = makeInterceptor({ state: "RECONNECTING" });
    await interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    expect(daemon.send).not.toHaveBeenCalled();
    expect((globalThis as any).chrome.downloads.cancel).not.toHaveBeenCalled();
  });

  it("happy path: OPEN + send ok → cancel + erase", async () => {
    const { interceptor, daemon } = makeInterceptor({ state: "OPEN", sendOk: true });
    await interceptor.handle({ id: 42, url: "https://a.com/x.zip" });
    expect(daemon.send).toHaveBeenCalledWith(expect.objectContaining({ url: "https://a.com/x.zip" }));
    expect((globalThis as any).chrome.downloads.cancel).toHaveBeenCalledWith(42);
    expect((globalThis as any).chrome.downloads.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it("send fails → browser keeps download (no cancel)", async () => {
    const { interceptor, daemon } = makeInterceptor({ state: "OPEN", sendOk: false });
    await interceptor.handle({ id: 42, url: "https://a.com/x.zip" });
    expect((globalThis as any).chrome.downloads.cancel).not.toHaveBeenCalled();
  });

  it("prefers finalUrl over url", async () => {
    const { interceptor, daemon } = makeInterceptor({});
    await interceptor.handle({ id: 1, url: "https://a.com/redirect", finalUrl: "https://b.com/final.zip" });
    expect(daemon.send).toHaveBeenCalledWith(expect.objectContaining({ url: "https://b.com/final.zip" }));
  });

  it("strips Cookie header from captured headers before sending", async () => {
    const { interceptor, daemon, headerStore } = makeInterceptor({});
    headerStore.set("https://a.com/x.zip", [
      { name: "User-Agent", value: "Mozilla" },
      { name: "Cookie", value: "session=abc" },
    ]);
    await interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    const arg = daemon.send.mock.calls[0][0];
    expect(arg.headers).toEqual([{ key: "User-Agent", value: "Mozilla" }]);
  });

  it("drops headers with no value", async () => {
    const { interceptor, daemon, headerStore } = makeInterceptor({});
    headerStore.set("https://a.com/x.zip", [
      { name: "User-Agent", value: "Mozilla" },
      { name: "Empty", value: undefined },
    ]);
    await interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    const arg = daemon.send.mock.calls[0][0];
    expect(arg.headers).toEqual([{ key: "User-Agent", value: "Mozilla" }]);
  });

  it("cookies.getAll rejection → sends with empty cookies", async () => {
    (globalThis as any).chrome.cookies.getAll = vi.fn(async () => { throw new Error("denied"); });
    const { interceptor, daemon } = makeInterceptor({});
    await interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    expect(daemon.send).toHaveBeenCalled();
    expect(daemon.send.mock.calls[0][0].cookies).toEqual([]);
  });

  it("maps Chrome cookies correctly", async () => {
    (globalThis as any).chrome.cookies.getAll = vi.fn(async () => [
      { name: "s", value: "v", domain: ".a.com", path: "/", secure: true, httpOnly: false, sameSite: "lax" },
    ]);
    const { interceptor, daemon } = makeInterceptor({});
    await interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    const arg = daemon.send.mock.calls[0][0];
    expect(arg.cookies[0]).toMatchObject({ Name: "s", Value: "v", Secure: true, SameSite: 1 });
  });

  it("clears header store entry after processing", async () => {
    const { interceptor, headerStore } = makeInterceptor({});
    headerStore.set("https://a.com/x.zip", [{ name: "H", value: "v" }]);
    await interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    expect(headerStore.get("https://a.com/x.zip")).toBeUndefined();
  });

  it("chrome.downloads.cancel rejection is logged, does not throw", async () => {
    (globalThis as any).chrome.downloads.cancel = vi.fn(async () => { throw new Error("cancel failed"); });
    const { interceptor } = makeInterceptor({});
    await expect(
      interceptor.handle({ id: 1, url: "https://a.com/x.zip" })
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/downloads/interceptor.test.ts
```

- [ ] **Step 3: Implement `src/downloads/interceptor.ts`**

```ts
import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import type { DaemonClient } from "../daemon/client";
import type { HeaderStore } from "../capture/header_store";
import type { CapturedDownload, DaemonHeader, DaemonCookie, ExtensionSettings } from "../types";
import { toDaemonCookie } from "../capture/cookie_mapper";

interface Deps {
  bus: EventBus;
  log: Logger;
  daemon: DaemonClient;
  headerStore: HeaderStore;
  getSettings: () => ExtensionSettings;
}

interface DownloadItem {
  id: number;
  url: string;
  finalUrl?: string;
}

export class DownloadInterceptor {
  private log: Logger;
  private daemon: DaemonClient;
  private headerStore: HeaderStore;
  private getSettings: () => ExtensionSettings;
  private bus: EventBus;

  constructor(deps: Deps) {
    this.bus = deps.bus;
    this.log = deps.log.child("interceptor");
    this.daemon = deps.daemon;
    this.headerStore = deps.headerStore;
    this.getSettings = deps.getSettings;
  }

  async handle(item: DownloadItem): Promise<void> {
    const settings = this.getSettings();
    if (!settings.interceptDownloads) {
      this.log.debug("skip_intercept_disabled", { url: item.url });
      return;
    }

    const url = item.finalUrl || item.url;
    if (!/^https?:\/\//i.test(url)) {
      this.log.debug("skip_non_http", { url });
      return;
    }

    if (this.daemon.state !== "OPEN") {
      this.log.info("skip_daemon_not_open", { url, state: this.daemon.state });
      this.bus.emit("send:outcome", { kind: "fallback", reason: this.daemon.state });
      return;   // browser continues
    }

    const msg = await this.buildMessage(url);
    const result = this.daemon.send(msg);
    this.headerStore.delete(url);

    if (!result.ok) {
      this.log.warn("send_failed_no_cancel", { url, reason: result.reason });
      this.bus.emit("send:outcome", { kind: "fallback", reason: result.reason });
      return;   // browser keeps downloading
    }

    this.bus.emit("send:outcome", { kind: "sent" });
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch (e) {
      this.log.warn("cancel_or_erase_failed", { id: item.id }, e);
    }
  }

  private async buildMessage(url: string): Promise<CapturedDownload> {
    const headers: DaemonHeader[] = [];
    const stored = this.headerStore.get(url);
    if (stored) {
      for (const h of stored) {
        if (h.value === undefined) continue;
        if (h.name.toLowerCase() === "cookie") continue;
        headers.push({ key: h.name, value: h.value });
      }
    }

    let cookies: DaemonCookie[] = [];
    try {
      const raw = await chrome.cookies.getAll({ url });
      cookies = raw.map(toDaemonCookie);
    } catch (e) {
      this.log.warn("cookies_get_failed", { url }, e);
    }

    return { url, headers, cookies };
  }
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/downloads/interceptor.test.ts
```

Expected: all ~12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/downloads/interceptor.ts tests/unit/downloads/interceptor.test.ts
git commit -m "feat(downloads): download interceptor with browser-continues fallback"
```

---

## Task 18: `downloads/video_handler.ts` — DOWNLOAD_VIDEO handler

**Files:**
- Create: `src/downloads/video_handler.ts`
- Create: `tests/unit/downloads/video_handler.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VideoHandler } from "../../../src/downloads/video_handler";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";

function makeHandler(opts: { state?: string; sendOk?: boolean } = {}) {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const daemon = {
    state: opts.state ?? "OPEN",
    send: vi.fn(() => (opts.sendOk ?? true) ? { ok: true } : { ok: false, reason: "connection_lost" }),
  } as any;
  return { handler: new VideoHandler({ bus, log, daemon }), daemon };
}

beforeEach(() => {
  (globalThis as any).chrome = {
    cookies: { getAll: vi.fn(async () => []) },
    downloads: { download: vi.fn(async () => 1) },
  };
});

describe("VideoHandler", () => {
  it("OPEN + send ok → reply {sent:true,fallback:false}", async () => {
    const { handler, daemon } = makeHandler({ state: "OPEN", sendOk: true });
    const r = await handler.handle({ type: "DOWNLOAD_VIDEO", url: "https://a.com/v.mp4" });
    expect(r).toEqual({ sent: true, fallback: false });
    expect(daemon.send).toHaveBeenCalled();
  });

  it("state not OPEN → calls chrome.downloads.download and replies fallback", async () => {
    const { handler } = makeHandler({ state: "RECONNECTING" });
    const r = await handler.handle({ type: "DOWNLOAD_VIDEO", url: "https://a.com/v.mp4", fileName: "my video?.mp4" });
    expect((globalThis as any).chrome.downloads.download).toHaveBeenCalledWith({
      url: "https://a.com/v.mp4",
      filename: "my video_.mp4",
    });
    expect(r).toEqual({ sent: false, fallback: true });
  });

  it("send fails → falls back to chrome.downloads.download", async () => {
    const { handler } = makeHandler({ state: "OPEN", sendOk: false });
    const r = await handler.handle({ type: "DOWNLOAD_VIDEO", url: "https://a.com/v.mp4" });
    expect((globalThis as any).chrome.downloads.download).toHaveBeenCalled();
    expect(r).toEqual({ sent: false, fallback: true });
  });

  it("adds Referer header when pageUrl is provided", async () => {
    const { handler, daemon } = makeHandler({});
    await handler.handle({
      type: "DOWNLOAD_VIDEO",
      url: "https://a.com/v.mp4",
      pageUrl: "https://site.com/watch",
    });
    const arg = daemon.send.mock.calls[0][0];
    expect(arg.headers).toContainEqual({ key: "Referer", value: "https://site.com/watch" });
  });

  it("omits Referer when pageUrl missing", async () => {
    const { handler, daemon } = makeHandler({});
    await handler.handle({ type: "DOWNLOAD_VIDEO", url: "https://a.com/v.mp4" });
    const arg = daemon.send.mock.calls[0][0];
    expect(arg.headers.find((h: any) => h.key === "Referer")).toBeUndefined();
  });

  it("sanitizes filename before fallback", async () => {
    const { handler } = makeHandler({ state: "IDLE" });
    await handler.handle({ type: "DOWNLOAD_VIDEO", url: "https://a.com/v.mp4", fileName: "a/b\\c*.mp4" });
    expect((globalThis as any).chrome.downloads.download).toHaveBeenCalledWith({
      url: "https://a.com/v.mp4",
      filename: "a_b_c_.mp4",
    });
  });

  it("chrome.downloads.download rejection yields fallback:false error", async () => {
    (globalThis as any).chrome.downloads.download = vi.fn(async () => { throw new Error("api_fail"); });
    const { handler } = makeHandler({ state: "IDLE" });
    const r = await handler.handle({ type: "DOWNLOAD_VIDEO", url: "https://a.com/v.mp4" });
    expect(r).toEqual({ sent: false, fallback: false, error: "download_api_failed" });
  });

  it("cookies.getAll rejection → sends with empty cookies", async () => {
    (globalThis as any).chrome.cookies.getAll = vi.fn(async () => { throw new Error("denied"); });
    const { handler, daemon } = makeHandler({});
    await handler.handle({ type: "DOWNLOAD_VIDEO", url: "https://a.com/v.mp4" });
    expect(daemon.send.mock.calls[0][0].cookies).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/downloads/video_handler.test.ts
```

- [ ] **Step 3: Implement `src/downloads/video_handler.ts`**

```ts
import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import type { DaemonClient } from "../daemon/client";
import type { CapturedDownload, DaemonHeader, DaemonCookie } from "../types";
import { toDaemonCookie } from "../capture/cookie_mapper";
import { sanitizeFilename } from "../capture/sanitize_filename";

interface Deps {
  bus: EventBus;
  log: Logger;
  daemon: DaemonClient;
}

interface VideoMsg {
  type: "DOWNLOAD_VIDEO";
  url: string;
  fileName?: string;
  pageUrl?: string;
}

export interface VideoResponse {
  sent: boolean;
  fallback: boolean;
  error?: string;
}

export class VideoHandler {
  private log: Logger;
  private daemon: DaemonClient;
  private bus: EventBus;

  constructor(deps: Deps) {
    this.bus = deps.bus;
    this.log = deps.log.child("video");
    this.daemon = deps.daemon;
  }

  async handle(msg: VideoMsg): Promise<VideoResponse> {
    if (this.daemon.state !== "OPEN") {
      return this.fallback(msg, `state_${this.daemon.state}`);
    }

    const captured = await this.buildMessage(msg);
    const r = this.daemon.send(captured);
    if (r.ok) {
      this.bus.emit("send:outcome", { kind: "sent" });
      return { sent: true, fallback: false };
    }
    return this.fallback(msg, r.reason);
  }

  private async fallback(msg: VideoMsg, reason: string): Promise<VideoResponse> {
    try {
      await chrome.downloads.download({
        url: msg.url,
        filename: sanitizeFilename(msg.fileName ?? ""),
      });
      this.bus.emit("send:outcome", { kind: "fallback", reason });
      return { sent: false, fallback: true };
    } catch (e) {
      this.log.warn("fallback_download_failed", { url: msg.url }, e);
      this.bus.emit("send:outcome", { kind: "drop", reason: "download_api_failed" });
      return { sent: false, fallback: false, error: "download_api_failed" };
    }
  }

  private async buildMessage(msg: VideoMsg): Promise<CapturedDownload> {
    const headers: DaemonHeader[] = [];
    if (msg.pageUrl) headers.push({ key: "Referer", value: msg.pageUrl });

    let cookies: DaemonCookie[] = [];
    try {
      const raw = await chrome.cookies.getAll({ url: msg.url });
      cookies = raw.map(toDaemonCookie);
    } catch (e) {
      this.log.warn("cookies_get_failed", { url: msg.url }, e);
    }

    return { url: msg.url, headers, cookies };
  }
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/downloads/video_handler.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/downloads/video_handler.ts tests/unit/downloads/video_handler.test.ts
git commit -m "feat(downloads): video handler with chrome.downloads.download fallback"
```

---

## Task 19: `messaging/router.ts` — chrome.runtime.onMessage dispatch

**Files:**
- Create: `src/messaging/router.ts`
- Create: `tests/unit/messaging/router.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { MessageRouter } from "../../../src/messaging/router";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";

function makeRouter(opts: { state?: string } = {}) {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const daemon = {
    state: opts.state ?? "OPEN",
    send: vi.fn(() => ({ ok: true })),
  } as any;
  const video = { handle: vi.fn(async () => ({ sent: true, fallback: false })) };
  const router = new MessageRouter({ bus, log, daemon, video });
  return { router, daemon, video, bus };
}

describe("MessageRouter", () => {
  it("dispatches DOWNLOAD_VIDEO to video handler", async () => {
    const { router, video } = makeRouter();
    const msg = { type: "DOWNLOAD_VIDEO", url: "u" };
    const r = await router.handle(msg);
    expect(video.handle).toHaveBeenCalledWith(msg);
    expect(r).toEqual({ sent: true, fallback: false });
  });

  it("handles GET_CONNECTION_STATUS with daemon state", async () => {
    const { router } = makeRouter({ state: "OPEN" });
    const r = await router.handle({ type: "GET_CONNECTION_STATUS" });
    expect(r).toEqual({ connected: true, state: "OPEN" });
  });

  it("GET_CONNECTION_STATUS reports connected=false when not OPEN", async () => {
    const { router } = makeRouter({ state: "RECONNECTING" });
    const r = await router.handle({ type: "GET_CONNECTION_STATUS" });
    expect(r).toEqual({ connected: false, state: "RECONNECTING" });
  });

  it("unknown message type → {error}", async () => {
    const { router } = makeRouter();
    const r = await router.handle({ type: "NO_SUCH_TYPE" } as any);
    expect(r).toEqual({ error: "unknown_type" });
  });

  it("handler throwing is caught and replied as error", async () => {
    const { router, video } = makeRouter();
    video.handle = vi.fn(async () => { throw new Error("boom"); });
    const r = await router.handle({ type: "DOWNLOAD_VIDEO", url: "u" }) as { error: string };
    expect(r.error).toBe("handler_threw");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/unit/messaging/router.test.ts
```

- [ ] **Step 3: Implement `src/messaging/router.ts`**

```ts
import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import type { DaemonClient } from "../daemon/client";
import type { VideoHandler, VideoResponse } from "../downloads/video_handler";

interface Deps {
  bus: EventBus;
  log: Logger;
  daemon: DaemonClient;
  video: VideoHandler;
}

export type IncomingMessage =
  | { type: "DOWNLOAD_VIDEO"; url: string; fileName?: string; pageUrl?: string }
  | { type: "GET_CONNECTION_STATUS" };

type Response =
  | VideoResponse
  | { connected: boolean; state: string }
  | { error: string };

export class MessageRouter {
  private log: Logger;
  private daemon: DaemonClient;
  private video: VideoHandler;

  constructor(deps: Deps) {
    this.log = deps.log.child("router");
    this.daemon = deps.daemon;
    this.video = deps.video;
  }

  async handle(msg: IncomingMessage): Promise<Response> {
    try {
      switch (msg.type) {
        case "DOWNLOAD_VIDEO":
          return await this.video.handle(msg);
        case "GET_CONNECTION_STATUS":
          return { connected: this.daemon.state === "OPEN", state: this.daemon.state };
        default: {
          this.log.warn("unknown_message_type", { msg });
          return { error: "unknown_type" };
        }
      }
    } catch (e) {
      this.log.error("handler_threw", { msg }, e);
      return { error: "handler_threw" };
    }
  }
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
npm test -- tests/unit/messaging/router.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/messaging/router.ts tests/unit/messaging/router.test.ts
git commit -m "feat(messaging): chrome.runtime.onMessage router"
```

---

## Task 20: Heartbeat compatibility verification (pre-cutover gate)

Before the cutover commit (Task 21), we verify that sending `{"type":"ping"}` to the daemon is safe.

**No files to create. This is a verification step.**

- [ ] **Step 1: Start a local WarpDL daemon**

Per your local setup — typically:

```bash
warp daemon       # or the equivalent start command
```

Verify it's listening:

```bash
ss -ltn | grep 3850
```

Expected: the daemon is listening on `:3850`.

- [ ] **Step 2: Send a ping via `websocat` or an equivalent CLI**

If `websocat` isn't installed:

```bash
cargo install websocat     # or: sudo pacman -S websocat on Arch
```

Then:

```bash
echo '{"type":"ping"}' | websocat -n1 ws://localhost:3850/
```

- [ ] **Step 3: Observe daemon behavior**

Watch the daemon's stderr/log. Expected outcomes:

| Observation | Verdict |
|---|---|
| Silent — no new log lines, no dropped socket | ✅ Safe: heartbeat works as designed |
| A log line about unmarshal error but socket stays open | ✅ Noisy but safe; file a follow-up to add a `type` discriminator on daemon side |
| Socket is closed / WebSocket goes to CLOSED | ❌ Unsafe; downgrade heartbeat before Task 21 |
| Phantom download entry in daemon state | ❌ Unsafe; downgrade heartbeat before Task 21 |

- [ ] **Step 4: Record outcome**

If ✅ safe: proceed to Task 21 with heartbeat enabled.

If ❌ unsafe: downgrade heartbeat by editing `src/daemon/client.ts`:

```ts
// In the constructor:
this.heartbeatEnabled = false;   // permanent override until daemon adds discriminator
```

And update the spec/plan cut-over commit message to document the downgrade.

- [ ] **Step 5: Write outcome into the next commit message**

No commit at this step; the outcome is captured in Task 21's commit message (Step 10).

---

## Task 21: Cut-over — rewrite `service_worker.ts` using the container

This is the single breaking commit. After this, the extension runs on the new stack.

**Files:**
- Modify: `src/core/container.ts` (add full wiring)
- Rewrite: `src/service_worker.ts`
- Create: `tests/integration/service_worker.test.ts`

- [ ] **Step 1: Flesh out `src/core/container.ts`**

Replace the entire file with:

```ts
import { EventBus } from "./events";
import { Logger } from "./logger";
import { realClock, Clock } from "./clock";
import { DaemonClient } from "../daemon/client";
import { HeaderStore } from "../capture/header_store";
import { DownloadInterceptor } from "../downloads/interceptor";
import { VideoHandler } from "../downloads/video_handler";
import { MessageRouter } from "../messaging/router";
import { loadSettings, onSettingsChanged } from "../settings";
import type { ExtensionSettings } from "../types";

export interface ContainerDeps {
  clock?: Clock;
  wsFactory?: (url: string) => WebSocket;
  writer?: (line: string) => void;
}

export class Container {
  readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private started = false;

  bus!: EventBus;
  log!: Logger;
  daemon!: DaemonClient;
  headerStore!: HeaderStore;
  interceptor!: DownloadInterceptor;
  video!: VideoHandler;
  router!: MessageRouter;

  private settings!: ExtensionSettings;
  private clock: Clock;
  private wsFactory: (url: string) => WebSocket;
  private writer?: (line: string) => void;

  constructor(deps: ContainerDeps = {}) {
    this.clock = deps.clock ?? realClock;
    this.wsFactory = deps.wsFactory ?? ((url) => new WebSocket(`ws://${url}`));
    this.writer = deps.writer;
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  currentSettings(): ExtensionSettings {
    return this.settings;
  }

  async start(): Promise<void> {
    if (this.started) return;

    this.settings = await loadSettings();
    this.bus = new EventBus();
    this.log = new Logger({ bus: this.bus, writer: this.writer });
    this.headerStore = new HeaderStore({ clock: this.clock });
    this.headerStore.startSweep();

    this.daemon = new DaemonClient({
      bus: this.bus,
      log: this.log.child("daemon"),
      clock: this.clock,
      wsFactory: this.wsFactory,
    });
    this.daemon.setUrl(this.settings.daemonUrl);
    this.daemon.start();

    this.video = new VideoHandler({ bus: this.bus, log: this.log, daemon: this.daemon });
    this.interceptor = new DownloadInterceptor({
      bus: this.bus,
      log: this.log,
      daemon: this.daemon,
      headerStore: this.headerStore,
      getSettings: () => this.settings,
    });
    this.router = new MessageRouter({ bus: this.bus, log: this.log, daemon: this.daemon, video: this.video });

    onSettingsChanged((s) => {
      this.settings = s;
      this.daemon.setUrl(s.daemonUrl);
      this.bus.emit("settings:applied", { url: s.daemonUrl, interceptEnabled: s.interceptDownloads });
    });

    this.started = true;
    this.readyResolve();
  }
}
```

- [ ] **Step 2: Update Task 5 stub container tests still pass**

```bash
npm test -- tests/unit/core/container.test.ts
```

Expected: still PASS (the skeleton tests don't depend on full wiring).

- [ ] **Step 3: Rewrite `src/service_worker.ts`**

Replace the entire file with:

```ts
import { Container } from "./core/container";

const container = new Container();

const ready = container.start().catch((err) => {
  console.error("[WarpDL] container start failed:", err);
  throw err;
});

// ── First-install thanks page ──

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const data = await chrome.storage.local.get("installed");
    if (data.installed != null) return;
    await chrome.storage.local.set({ installed: true });
    await chrome.tabs.create({ url: "thanks.html" });
  }
});

// ── webRequest header capture ──

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    ready.then(() => {
      if (!details.requestHeaders) return;
      container.headerStore.set(details.url, details.requestHeaders as { name: string; value?: string }[]);
    }).catch(() => {});
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    ready.then(() => {
      if (details.redirectUrl) container.headerStore.migrate(details.url, details.redirectUrl);
    }).catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    ready.then(() => container.headerStore.delete(details.url)).catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    ready.then(() => container.headerStore.delete(details.url)).catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

// ── Download interception ──

chrome.downloads.onCreated.addListener((item) => {
  ready.then(() => container.interceptor.handle(item as { id: number; url: string; finalUrl?: string })).catch(() => {});
});

// ── Message handling ──

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ready.then(() => container.router.handle(message as any)).then(sendResponse).catch((err) => {
    sendResponse({ error: String(err) });
  });
  return true;   // async response
});

// ── Safety nets ──

(self as unknown as ServiceWorkerGlobalScope).addEventListener("unhandledrejection", (e: any) => {
  console.error("[WarpDL] unhandledrejection:", e.reason);
  e.preventDefault();
});
(self as unknown as ServiceWorkerGlobalScope).addEventListener("error", (e: any) => {
  console.error("[WarpDL] uncaught error:", e.message, "at", e.filename, ":", e.lineno);
});
```

- [ ] **Step 4: Write integration tests**

Create `tests/integration/service_worker.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Container } from "../../src/core/container";
import { FakeClock } from "../fixtures/fake_clock";
import { makeWsFactory } from "../fixtures/fake_websocket";

beforeEach(() => {
  (globalThis as any).chrome.storage.sync._raw.settings = {
    daemonUrl: "localhost:3850",
    interceptDownloads: true,
  };
});

function build() {
  const clock = new FakeClock();
  const { factory, lastSocket } = makeWsFactory();
  const container = new Container({
    clock: clock as any,
    wsFactory: factory as unknown as (u: string) => WebSocket,
    writer: () => {},
  });
  return { container, clock, lastSocket };
}

describe("service_worker integration", () => {
  it("boots and opens daemon socket", async () => {
    const { container, lastSocket } = build();
    await container.start();
    expect(container.daemon.state).toBe("CONNECTING");
    lastSocket()!.simulateOpen();
    expect(container.daemon.state).toBe("OPEN");
  });

  it("download intercept: OPEN path", async () => {
    const { container, lastSocket } = build();
    await container.start();
    lastSocket()!.simulateOpen();
    (globalThis as any).chrome.cookies.getAll = vi.fn(async () => []);
    await container.interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    expect(lastSocket()!.send).toHaveBeenCalled();
    expect((globalThis as any).chrome.downloads.cancel).toHaveBeenCalledWith(1);
  });

  it("download intercept: daemon offline → browser keeps download", async () => {
    const { container } = build();
    await container.start();
    // Don't simulate open — daemon stays in CONNECTING.
    await container.interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    expect((globalThis as any).chrome.downloads.cancel).not.toHaveBeenCalled();
  });

  it("reconnects after daemon disconnect", async () => {
    const { container, lastSocket, clock } = build();
    await container.start();
    lastSocket()!.simulateOpen();
    lastSocket()!.simulateClose();
    expect(container.daemon.state).toBe("RECONNECTING");
    clock.tick(5000);
    expect(container.daemon.state).toBe("CONNECTING");
    lastSocket()!.simulateOpen();
    expect(container.daemon.state).toBe("OPEN");
  });

  it("settings URL change reconnects", async () => {
    const { container, lastSocket } = build();
    await container.start();
    lastSocket()!.simulateOpen();
    (globalThis as any).chrome.storage.onChanged.fire(
      { settings: { newValue: { daemonUrl: "otherhost:9999", interceptDownloads: true } } },
      "sync"
    );
    expect(lastSocket()!.url).toContain("otherhost:9999");
  });

  it("GET_CONNECTION_STATUS reflects current state", async () => {
    const { container, lastSocket } = build();
    await container.start();
    expect(await container.router.handle({ type: "GET_CONNECTION_STATUS" })).toEqual({
      connected: false,
      state: "CONNECTING",
    });
    lastSocket()!.simulateOpen();
    expect(await container.router.handle({ type: "GET_CONNECTION_STATUS" })).toEqual({
      connected: true,
      state: "OPEN",
    });
  });

  it("header capture flow: header set → used in download", async () => {
    const { container, lastSocket } = build();
    await container.start();
    lastSocket()!.simulateOpen();
    container.headerStore.set("https://a.com/x.zip", [{ name: "User-Agent", value: "Mozilla" }]);
    (globalThis as any).chrome.cookies.getAll = vi.fn(async () => []);
    await container.interceptor.handle({ id: 1, url: "https://a.com/x.zip" });
    const payload = JSON.parse(lastSocket()!.send.mock.calls[0][0] as string);
    expect(payload.headers).toEqual([{ key: "User-Agent", value: "Mozilla" }]);
  });
});
```

- [ ] **Step 5: Run integration tests**

```bash
npm test -- tests/integration/service_worker.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Run full test suite with coverage**

```bash
npm run test:coverage
```

Expected: all tests pass; coverage ≥95 % on all four thresholds. If coverage dips below 95 %, open the HTML report (`coverage/index.html`) and add focused tests for uncovered branches.

- [ ] **Step 7: Verify the built extension loads**

```bash
npm run build
```

Then load `dist/` in Chrome (chrome://extensions → Developer mode → Load unpacked).

Expected:
- No errors in chrome://extensions.
- Popup opens, shows "Connecting…" or "Connected" if daemon is running.

- [ ] **Step 8: Smoke-test against live daemon (from §8.6 of spec)**

Run scenarios 1–8 manually. If any fail, stop and fix before committing.

- [ ] **Step 9: Delete obsolete code**

The previous `service_worker.ts` is already overwritten in Step 3. Confirm no stale imports remain:

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 10: Commit (single cut-over)**

```bash
git add src/core/container.ts src/service_worker.ts tests/integration/service_worker.test.ts
git commit -m "refactor: migrate service worker to container-based architecture

Replaces ad-hoc WebSocket handling in src/service_worker.ts with a
DaemonClient state machine wired through src/core/container.ts.

- daemon: state machine with heartbeat, jittered backoff, circuit breaker
- capture: TTL+LRU header store with periodic sweep
- downloads: interceptor (browser-continues fallback) + video handler (chrome.downloads.download fallback)
- messaging: typed router for chrome.runtime.onMessage
- core: typed EventBus, leveled logger with redaction + ring buffer

Heartbeat verification (Task 20): <record outcome here: SAFE / DOWNGRADED>."
```

---

## Task 22: Rework `popup.ts` + `popup.html` — live status, Retry, diagnostics

**Files:**
- Modify: `src/popup.ts`
- Modify: `public/popup.html`
- Modify: `src/service_worker.ts` (add port handler)

- [ ] **Step 1: Add port handler in `src/service_worker.ts`**

Append before the safety-net block at the bottom:

```ts
// ── Popup status port ──

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup-status") return;
  ready.then(() => {
    const off = container.bus.on("daemon:state", (e) => {
      try {
        port.postMessage({ type: "state", state: e.to, cause: e.cause });
      } catch { /* port disconnected */ }
    });
    // Immediately push current state
    port.postMessage({ type: "state", state: container.daemon.state });
    port.onMessage.addListener((msg: { type: string }) => {
      if (msg.type === "resume") container.daemon.resume();
    });
    port.onDisconnect.addListener(() => off());
  }).catch(() => {});
});
```

- [ ] **Step 2: Replace `public/popup.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 340px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 16px;
    }
    .header {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 16px; padding-bottom: 12px;
      border-bottom: 1px solid #2a2a4a;
    }
    .header h1 { font-size: 16px; font-weight: 600; color: #fff; }
    .status-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: #888; flex-shrink: 0;
    }
    .status-dot.connected { background: #44ff44; }
    .status-dot.connecting { background: #ffaa44; }
    .status-dot.disabled { background: #ff4444; }
    .status-text { font-size: 11px; color: #aaa; margin-left: auto; }

    .banner {
      padding: 8px 10px; border-radius: 6px; margin-bottom: 12px;
      font-size: 12px;
    }
    .banner.error { background: #441a1a; color: #ffb0b0; }
    .banner.warn { background: #443f1a; color: #ffe0a0; }
    .banner.info { background: #1a2a44; color: #aad0ff; }
    .banner button { margin-left: 8px; padding: 3px 10px; font-size: 11px; }

    .field { margin-bottom: 12px; }
    .field label {
      display: block; font-size: 11px; color: #aaa; margin-bottom: 4px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .field input {
      width: 100%; padding: 8px 10px; background: #16213e;
      border: 1px solid #2a2a4a; border-radius: 6px;
      color: #e0e0e0; font-size: 13px; outline: none;
    }
    .field input:focus { border-color: #5a5aff; }
    .field .error-msg { color: #ff7070; font-size: 11px; margin-top: 4px; min-height: 14px; }

    .toggle-row {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; padding: 8px 0;
    }
    .toggle { position: relative; width: 40px; height: 22px; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle .slider {
      position: absolute; cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #333; border-radius: 22px; transition: 0.2s;
    }
    .toggle .slider::before {
      content: ""; position: absolute; height: 16px; width: 16px;
      left: 3px; bottom: 3px; background: #fff; border-radius: 50%;
      transition: 0.2s;
    }
    .toggle input:checked + .slider { background: #5a5aff; }
    .toggle input:checked + .slider::before { transform: translateX(18px); }

    button {
      padding: 8px 12px; border: none; border-radius: 6px;
      font-size: 13px; cursor: pointer; font-weight: 500;
      background: #5a5aff; color: #fff;
    }
    button:hover { opacity: 0.85; }
    button.secondary { background: #333; }

    .feedback { text-align: center; font-size: 11px; margin-top: 8px; min-height: 16px; color: #44ff44; }
    .feedback.error { color: #ff4444; }

    .diag {
      display: none; margin-top: 16px; padding-top: 12px;
      border-top: 1px solid #2a2a4a; font-size: 11px;
    }
    .diag.visible { display: block; }
    .diag pre {
      max-height: 200px; overflow-y: auto; background: #0f0f1f;
      padding: 8px; border-radius: 4px; font-family: monospace;
      white-space: pre-wrap; font-size: 10px; color: #aaa;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 id="title">WarpDL</h1>
    <div id="status-dot" class="status-dot"></div>
    <span id="status-text" class="status-text">—</span>
  </div>

  <div id="banner" class="banner" style="display:none;">
    <span id="banner-text"></span>
    <button id="btn-retry" style="display:none;">Retry</button>
  </div>

  <div class="field">
    <label>Daemon Address</label>
    <input type="text" id="daemon-url" placeholder="localhost:3850">
    <div id="url-error" class="error-msg"></div>
  </div>

  <div class="toggle-row">
    <label>Intercept Downloads</label>
    <div class="toggle">
      <input type="checkbox" id="intercept-toggle" checked>
      <span class="slider"></span>
    </div>
  </div>

  <button id="btn-save">Save</button>

  <div id="feedback" class="feedback"></div>

  <div id="diag" class="diag">
    <strong>Diagnostics</strong>
    <pre id="diag-log">(empty)</pre>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 3: Rewrite `src/popup.ts`**

```ts
import { loadSettings, saveSettings } from "./settings";
import { validateDaemonUrl } from "./capture/url_validator";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const title = $<HTMLHeadingElement>("title");
const statusDot = $<HTMLDivElement>("status-dot");
const statusText = $<HTMLSpanElement>("status-text");
const banner = $<HTMLDivElement>("banner");
const bannerText = $<HTMLSpanElement>("banner-text");
const btnRetry = $<HTMLButtonElement>("btn-retry");
const daemonUrlInput = $<HTMLInputElement>("daemon-url");
const urlError = $<HTMLDivElement>("url-error");
const interceptToggle = $<HTMLInputElement>("intercept-toggle");
const btnSave = $<HTMLButtonElement>("btn-save");
const feedback = $<HTMLDivElement>("feedback");
const diag = $<HTMLDivElement>("diag");
const diagLog = $<HTMLPreElement>("diag-log");

let titleClicks = 0;
let titleClickTimer: number | null = null;

title.addEventListener("click", () => {
  titleClicks++;
  if (titleClickTimer !== null) clearTimeout(titleClickTimer);
  titleClickTimer = window.setTimeout(() => { titleClicks = 0; }, 800);
  if (titleClicks >= 3) {
    diag.classList.toggle("visible");
    titleClicks = 0;
    if (diag.classList.contains("visible")) refreshDiagnostics();
  }
});

async function refreshDiagnostics(): Promise<void> {
  try {
    const data = await chrome.storage.local.get("ring_buffer");
    const ring = (data.ring_buffer as unknown[]) || [];
    diagLog.textContent = ring.length === 0
      ? "(empty)"
      : ring.map((e: any) => `[${e.level}] ${e.scope} ${e.msg}`).join("\n");
  } catch {
    diagLog.textContent = "(failed to load)";
  }
}

function setStatus(state: string): void {
  statusDot.className = "status-dot";
  banner.style.display = "none";
  btnRetry.style.display = "none";

  switch (state) {
    case "OPEN":
      statusDot.classList.add("connected");
      statusText.textContent = "Connected";
      break;
    case "CONNECTING":
      statusDot.classList.add("connecting");
      statusText.textContent = "Connecting…";
      break;
    case "RECONNECTING":
      statusDot.classList.add("connecting");
      statusText.textContent = "Reconnecting…";
      break;
    case "DISABLED":
      statusDot.classList.add("disabled");
      statusText.textContent = "Daemon unreachable";
      banner.className = "banner error";
      banner.style.display = "block";
      bannerText.textContent = "Connection disabled after repeated failures.";
      btnRetry.style.display = "inline-block";
      break;
    case "IDLE":
    default:
      statusText.textContent = state;
      break;
  }
}

btnRetry.addEventListener("click", () => {
  port.postMessage({ type: "resume" });
});

async function populateFields(): Promise<void> {
  const s = await loadSettings();
  daemonUrlInput.value = s.daemonUrl;
  interceptToggle.checked = s.interceptDownloads;
}

function showFeedback(msg: string, isError = false): void {
  feedback.textContent = msg;
  feedback.className = isError ? "feedback error" : "feedback";
  setTimeout(() => { feedback.textContent = ""; }, 3000);
}

btnSave.addEventListener("click", async () => {
  const raw = daemonUrlInput.value.trim();
  const validation = validateDaemonUrl(raw);
  if (!validation.ok) {
    urlError.textContent = `Invalid: ${validation.error}`;
    return;
  }
  urlError.textContent = "";
  await saveSettings({
    daemonUrl: `${validation.host}:${validation.port}`,
    interceptDownloads: interceptToggle.checked,
  });
  showFeedback("Settings saved");
});

// Live status via chrome.runtime.Port
const port = chrome.runtime.connect({ name: "popup-status" });
port.onMessage.addListener((msg: { type: string; state?: string }) => {
  if (msg.type === "state" && msg.state) setStatus(msg.state);
});
port.onDisconnect.addListener(() => {
  setStatus("IDLE");
});

populateFields();
```

- [ ] **Step 4: Update `webpack.config.js` — no changes needed (popup entry unchanged)**

Verify the webpack config still lists `popup` as an entry point. No change required.

- [ ] **Step 5: Build and load the extension**

```bash
npm run build
```

Load `dist/` in Chrome. Click the WarpDL action icon. Expected:

- Status dot updates live as daemon starts/stops.
- Invalid URL in the input → inline error message.
- "Retry" button appears if the daemon stays down long enough to hit the breaker.
- Triple-click the "WarpDL" title → diagnostics panel toggles.

- [ ] **Step 6: Smoke-test scenarios 1–8 from spec §8.6**

All must pass. If any fails, fix and re-test.

- [ ] **Step 7: Commit**

```bash
git add src/service_worker.ts src/popup.ts public/popup.html
git commit -m "feat(popup): live status port, retry button, diagnostics panel"
```

---

## Task 23: Final verification

**No new files. Verify the whole suite.**

- [ ] **Step 1: Full test run with coverage gate**

```bash
npm run test:coverage
```

Expected: all tests PASS; all four coverage thresholds (lines, branches, functions, statements) at ≥95 %. If below threshold, add tests for uncovered branches before proceeding.

- [ ] **Step 2: Type check the entire tree**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: builds without warnings or errors. `dist/` contains updated artifacts.

- [ ] **Step 4: Verify bundle size**

```bash
ls -lh dist/*.js
```

Expected: `service_worker.js` is in the low single-digit KB range (gzipped would be ~6 KB; unminified ~20 KB). A dramatic increase suggests a dev dep leaked into the bundle.

- [ ] **Step 5: Load unpacked extension + run all 8 smoke scenarios from spec §8.6**

Each must pass. Record any anomalies.

- [ ] **Step 6: Inspect chrome://extensions "Errors" tab**

Expected: no errors. If there are any, investigate before merging.

- [ ] **Step 7: Push branch and open PR**

```bash
git push -u origin ws-hardening
gh pr create --title "WebSocket ecosystem hardening" \
  --body "Implements docs/specs/2026-04-23-websocket-hardening-design.md.

## Summary
- DaemonClient state machine (IDLE / CONNECTING / OPEN / RECONNECTING / DISABLED)
- Application-level heartbeat + bufferedAmount stall detection
- Jittered exponential backoff + 10-failure circuit breaker
- Typed EventBus and leveled Logger with redaction + ring buffer
- TTL+LRU HeaderStore with periodic sweep
- URL syntax validation at popup and at DaemonClient.setUrl()
- Browser-download fallback for both download-interceptor and video-handler paths
- Vitest harness with ≥95% coverage gate on new modules

## Test plan
- [x] npm run test:coverage — all pass, ≥95% on 4 thresholds
- [x] npm run build — success
- [x] 8/8 smoke scenarios from spec §8.6 pass against live daemon
- [x] No errors in chrome://extensions after load-unpacked"
```

---

## Self-review

### Spec coverage check

| Spec section | Task | Covered |
|---|---|---|
| §3.1 Module layout | Tasks 3–19 create every module listed | ✅ |
| §3.3 Event bus | Task 3 | ✅ |
| §3.4 DI container | Tasks 5, 21 | ✅ |
| §4.1 States enum | Task 6 | ✅ |
| §4.2 Transition table | Task 6 | ✅ |
| §4.3 Heartbeat | Task 14 | ✅ |
| §4.4 Backoff | Task 7 | ✅ |
| §4.5 Circuit breaker | Tasks 13, 15 | ✅ |
| §4.6 Public API | Task 13 (SendResult type, methods) | ✅ |
| §5.1 Interceptor flow | Task 17 | ✅ |
| §5.2 Video handler flow | Task 18 | ✅ |
| §5.3 Header store lifecycle | Tasks 12, 21 (wire-up) | ✅ |
| §5.4 Popup status | Task 22 | ✅ |
| §6.1 URL validator | Task 9 | ✅ |
| §6.2 Init race fix | Tasks 5, 21 (`ready` promise) | ✅ |
| §6.3 Log redaction | Task 4 | ✅ |
| §6.3 Filename sanitizer | Task 11 | ✅ |
| §7.1 Error categories | Implicit in module error paths (Tasks 13–19) | ✅ |
| §7.2 Logger interface | Task 4 | ✅ |
| §7.3 Unhandled rejection safety net | Task 21 (in service_worker.ts) | ✅ |
| §7.4 Ring buffer | Task 4 | ✅ |
| §7.5 Per-module error paths | Tests in Tasks 13–19 exercise each | ✅ |
| §7.6 Popup error UX | Task 22 | ✅ |
| §8 Vitest harness | Task 1 | ✅ |
| §8.2 Test fixtures | Task 2 | ✅ |
| §8.3 Coverage targets | Each module task has ≥ spec's test count | ✅ |
| §8.4 Coverage gate | Task 1 (vitest.config.ts thresholds) | ✅ |
| §8.6 Manual smoke checklist | Tasks 21, 22, 23 | ✅ |
| §9 Migration path | Tasks 1–23 implement all 10 commits | ✅ |
| §9.4 Heartbeat verification | Task 20 | ✅ |
| §10 Acceptance criteria | Task 23 Step 1–6 | ✅ |

### Placeholder scan

No "TBD", "TODO", "implement later", "add error handling", "similar to Task N" markers. Every code block is a complete unit. Every test block has real assertions.

Exception: Task 21 Step 10's commit message contains `<record outcome here: SAFE / DOWNGRADED>` — this is intentional, filled in at execution time based on Task 20's result.

### Type consistency check

- `State` type: defined in Task 3 stub, fleshed out in Task 6 — consistent `"IDLE" | "CONNECTING" | ...` across all uses.
- `SendResult`: defined in Task 13, used by `sendOrFallback` in Task 16 and `VideoHandler`/`DownloadInterceptor` consumers.
- `Clock`: defined in `src/core/clock.ts` (Task 13 Step 1), used by `HeaderStore` after refactor and by `DaemonClient`. Task 12 initially uses an inline `ClockLike` — replaced in Task 13 Step 1.
- `DaemonCookie`, `DaemonHeader`, `CapturedDownload`: all imported from `src/types.ts`, which Task 6 spec says stays unchanged. (The existing types are already correct — verified in §4.1.)
- `ValidationResult` / `ValidationError`: defined in Task 9, imported wherever `validateDaemonUrl` is called.
- `EventBus` and `Events` schema: defined in Task 3. Each module uses `bus.emit("name", payload)` with the exact keys and payload shape from the schema.
- `Logger`: `log.child("scope")` pattern used consistently.
- `VideoResponse`: defined in Task 18, imported by `MessageRouter` in Task 19.

One gap spotted during review — **fixed inline**: Task 17's `DownloadInterceptor.handle()` takes a type that includes `{ id, url, finalUrl? }` but the chrome API fires with a full `DownloadItem`. Task 21 Step 3's call `container.interceptor.handle(item as { id: number; url: string; finalUrl?: string })` explicitly casts, so type compatibility is fine.

### Scope check

The plan covers one spec (§2–§11 of the design doc) and produces the entire new architecture in one branch. No decomposition needed.

### Sanity checklist

- [x] Every task has exact file paths (no relative "put it somewhere")
- [x] Every step with code has the actual code
- [x] Every step with tests has real assertions
- [x] Every test step runs a specific Vitest command
- [x] Every task ends with a commit step
- [x] No references to undefined symbols
- [x] TDD order preserved in every task (tests before implementation)
- [x] Cut-over isolated to Task 21; Tasks 1–20 are safely additive; Task 22 depends on 21

---

## Execution guidance

- Tasks 1–19 are strictly additive. An agent can execute them in order with a fresh subagent per task.
- Task 20 is a manual verification step; it requires a running daemon. Don't skip.
- Task 21 is the cut-over. Ensure Task 20 outcome is known before executing.
- Task 22 depends on Task 21 (uses the port the cut-over adds).
- Task 23 is the final gate — don't consider the feature "done" until all six sub-steps pass.

If any task fails, stop and investigate root cause before patching. Do not `--no-verify` past a failing hook.

