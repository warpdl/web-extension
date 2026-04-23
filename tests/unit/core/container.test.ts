import { describe, it, expect, vi } from "vitest";
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

  it("ready rejects and start() rethrows when initialization fails", async () => {
    const boom = new Error("storage unavailable");
    (globalThis as any).chrome.storage.sync.get = vi.fn(() => Promise.reject(boom));
    const c = new Container();
    let rejected: unknown;
    c.ready.catch((e) => { rejected = e; });
    await expect(c.start()).rejects.toThrow("storage unavailable");
    await Promise.resolve();
    expect(rejected).toBe(boom);
    expect(c.isStarted).toBe(false);
  });
});
