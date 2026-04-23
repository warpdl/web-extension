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
