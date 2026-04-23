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
