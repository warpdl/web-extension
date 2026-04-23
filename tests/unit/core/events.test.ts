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
