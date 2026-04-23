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
