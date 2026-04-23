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
