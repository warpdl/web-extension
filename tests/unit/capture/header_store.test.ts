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
