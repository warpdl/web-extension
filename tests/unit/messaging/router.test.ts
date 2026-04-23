import { describe, it, expect, vi } from "vitest";
import { MessageRouter } from "../../../src/messaging/router";
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

describe("MessageRouter", () => {
  it("dispatches DOWNLOAD_VIDEO to video handler", async () => {
    const { router, video } = makeRouter();
    const msg = { type: "DOWNLOAD_VIDEO", url: "u" };
    const r = await router.handle(msg);
    expect(video.handle).toHaveBeenCalledWith(msg);
    expect(r).toEqual({ sent: true, fallback: false });
  });

  it("handles GET_CONNECTION_STATUS with daemon state", async () => {
    const { router } = makeRouter({ state: "OPEN" });
    const r = await router.handle({ type: "GET_CONNECTION_STATUS" });
    expect(r).toEqual({ connected: true, state: "OPEN" });
  });

  it("GET_CONNECTION_STATUS reports connected=false when not OPEN", async () => {
    const { router } = makeRouter({ state: "RECONNECTING" });
    const r = await router.handle({ type: "GET_CONNECTION_STATUS" });
    expect(r).toEqual({ connected: false, state: "RECONNECTING" });
  });

  it("unknown message type → {error}", async () => {
    const { router } = makeRouter();
    const r = await router.handle({ type: "NO_SUCH_TYPE" } as any);
    expect(r).toEqual({ error: "unknown_type" });
  });

  it("handler throwing is caught and replied as error", async () => {
    const { router, video } = makeRouter();
    video.handle = vi.fn(async () => { throw new Error("boom"); });
    const r = await router.handle({ type: "DOWNLOAD_VIDEO", url: "u" }) as { error: string };
    expect(r.error).toBe("handler_threw");
  });
});
