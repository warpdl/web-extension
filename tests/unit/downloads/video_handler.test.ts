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
