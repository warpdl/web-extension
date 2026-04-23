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
