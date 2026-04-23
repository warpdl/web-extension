import { describe, it, expect, vi } from "vitest";
import { sendOrFallback, mapStateToReason } from "../../../src/downloads/send_or_fallback";
import type { DaemonClient } from "../../../src/daemon/client";

function mkClient(state: string, sendOk = true) {
  return {
    state,
    send: vi.fn(() => sendOk ? { ok: true } : { ok: false, reason: "connection_lost" }),
  } as unknown as DaemonClient;
}

describe("sendOrFallback", () => {
  it("returns {kind:sent} when daemon is OPEN and send ok", async () => {
    const client = mkClient("OPEN", true);
    const r = await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, { onFallback: vi.fn() });
    expect(r).toEqual({ kind: "sent" });
    expect(client.send).toHaveBeenCalled();
  });

  it("calls onFallback when daemon is not OPEN", async () => {
    const client = mkClient("RECONNECTING");
    const onFallback = vi.fn();
    const r = await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, { onFallback });
    expect(r).toEqual({ kind: "fallback", reason: "reconnecting" });
    expect(client.send).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith({ reason: "reconnecting" });
  });

  it("calls onFallback when send fails", async () => {
    const client = mkClient("OPEN", false);
    const onFallback = vi.fn();
    const r = await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, { onFallback });
    expect(r).toEqual({ kind: "fallback", reason: "connection_lost" });
    expect(onFallback).toHaveBeenCalled();
  });

  it("works with onFallback=undefined (decision-only mode)", async () => {
    const client = mkClient("IDLE");
    const r = await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, {});
    expect(r).toEqual({ kind: "fallback", reason: "idle" });
  });

  it("onFallback can be async and is awaited", async () => {
    const client = mkClient("IDLE");
    const calls: string[] = [];
    const onFallback = async () => {
      calls.push("start");
      await new Promise((r) => setTimeout(r, 1));
      calls.push("end");
    };
    await sendOrFallback(client, { url: "u", headers: [], cookies: [] }, { onFallback });
    expect(calls).toEqual(["start", "end"]);
  });
});

describe("mapStateToReason", () => {
  it("maps every known state", () => {
    expect(mapStateToReason("IDLE")).toBe("idle");
    expect(mapStateToReason("CONNECTING")).toBe("connecting");
    expect(mapStateToReason("RECONNECTING")).toBe("reconnecting");
    expect(mapStateToReason("DISABLED")).toBe("disabled");
  });
  it("returns 'unknown' for unrecognized states", () => {
    expect(mapStateToReason("WEIRD")).toBe("unknown");
  });
});
