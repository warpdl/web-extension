import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MessageRouter } from "../../../src/messaging/router";
import type { IncomingMessage } from "../../../src/messaging/router";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";

function makeRouter(opts: { state?: string } = {}) {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const daemon = {
    state: opts.state ?? "OPEN",
    send: vi.fn(() => ({ ok: true })),
  } as any;
  const video = { handle: vi.fn(async () => ({ sent: true, fallback: false })) };
  const router = new MessageRouter({ bus, log, daemon, video });
  return { router, daemon, video, bus };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  (globalThis as any).fetch = fetchSpy;
  // Settings load: stub chrome.storage.sync.get (promise-based) for loadSettings()
  (globalThis as any).chrome = {
    storage: {
      sync: {
        get: vi.fn(async () => ({ settings: { daemonUrl: "localhost:3850" } })),
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).fetch;
  delete (globalThis as any).chrome;
  vi.restoreAllMocks();
});

describe("MessageRouter", () => {
  it("dispatches DOWNLOAD_VIDEO to video handler", async () => {
    const { router, video } = makeRouter();
    const msg: IncomingMessage = { type: "DOWNLOAD_VIDEO", url: "u" };
    const r = await router.handle(msg);
    expect(video.handle).toHaveBeenCalledWith(msg);
    expect(r).toEqual({ sent: true, fallback: false });
  });

  it("handles GET_CONNECTION_STATUS with daemon state", async () => {
    const { router } = makeRouter({ state: "OPEN" });
    const r = await router.handle({ type: "GET_CONNECTION_STATUS" } as IncomingMessage);
    expect(r).toEqual({ connected: true, state: "OPEN" });
  });

  it("GET_CONNECTION_STATUS reports connected=false when not OPEN", async () => {
    const { router } = makeRouter({ state: "RECONNECTING" });
    const r = await router.handle({ type: "GET_CONNECTION_STATUS" } as IncomingMessage);
    expect(r).toEqual({ connected: false, state: "RECONNECTING" });
  });

  it("unknown message type → {error}", async () => {
    const { router } = makeRouter();
    const r = await router.handle({ type: "NO_SUCH_TYPE" } as unknown as IncomingMessage);
    expect(r).toEqual({ error: "unknown_type" });
  });

  it("handler throwing is caught and replied as error", async () => {
    const { router, video } = makeRouter();
    video.handle = vi.fn(async () => { throw new Error("boom"); });
    const r = await router.handle({ type: "DOWNLOAD_VIDEO", url: "u" } as IncomingMessage) as { error: string };
    expect(r.error).toBe("handler_threw");
  });

  it("DOWNLOAD_YT_VIDEO calls daemon's youtube.download and returns ok", async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 200, ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { gid: "g", muxed: true, fileName: "v.mp4" } }),
    });
    const { router } = makeRouter();
    const r = await router.handle({
      type: "DOWNLOAD_YT_VIDEO",
      videoId: "abc",
      videoFormatId: "137",
      audioFormatId: "140",
    } as IncomingMessage) as { ok: true; result: any };
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({ gid: "g", muxed: true, fileName: "v.mp4" });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.method).toBe("youtube.download");
    expect(body.params).toEqual({
      videoId: "abc",
      videoFormatId: "137",
      audioFormatId: "140",
      fileName: undefined,
    });
  });

  it("DOWNLOAD_YT_VIDEO surfaces daemon errors", async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 200, ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32105, message: "ffmpeg not found" } }),
    });
    const { router } = makeRouter();
    const r = await router.handle({
      type: "DOWNLOAD_YT_VIDEO",
      videoId: "abc",
      videoFormatId: "137",
      audioFormatId: "140",
    } as IncomingMessage) as { ok: false; error: string; code?: number };
    expect(r.ok).toBe(false);
    expect(r.code).toBe(-32105);
    expect(r.error).toContain("ffmpeg");
  });
});
