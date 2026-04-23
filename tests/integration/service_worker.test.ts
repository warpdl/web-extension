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
