import { describe, it, expect, beforeEach, vi } from "vitest";
import { DaemonClient } from "../../../src/daemon/client";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";
import { FakeClock } from "../../fixtures/fake_clock";
import { makeWsFactory, FakeWebSocket } from "../../fixtures/fake_websocket";

function makeClient(urlArg = "localhost:3850") {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const clock = new FakeClock();
  const { factory, lastSocket } = makeWsFactory();
  const client = new DaemonClient({
    bus,
    log,
    clock,
    wsFactory: factory as unknown as (u: string) => WebSocket,
    disableHeartbeat: true,
    disableBreaker: true,
  });
  client.setUrl(urlArg);
  return { bus, log, clock, client, lastSocket };
}

describe("DaemonClient transitions", () => {
  it("starts in IDLE", () => {
    const { client } = makeClient();
    expect(client.state).toBe("IDLE");
  });

  it("start() → CONNECTING", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    expect(client.state).toBe("CONNECTING");
    expect(lastSocket()).not.toBeNull();
  });

  it("CONNECTING → OPEN on ws.onopen", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    expect(client.state).toBe("OPEN");
  });

  it("CONNECTING → RECONNECTING on ws.onerror", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateError();
    lastSocket()!.simulateClose();   // usually error is followed by close
    expect(client.state).toBe("RECONNECTING");
  });

  it("CONNECTING → RECONNECTING on ws.onclose before open", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateClose();
    expect(client.state).toBe("RECONNECTING");
  });

  it("OPEN → RECONNECTING on ws.onclose", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    lastSocket()!.simulateClose();
    expect(client.state).toBe("RECONNECTING");
  });

  it("RECONNECTING → CONNECTING when backoff fires", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateClose();
    expect(client.state).toBe("RECONNECTING");
    clock.tick(5000);   // well past 1s jittered backoff
    expect(client.state).toBe("CONNECTING");
  });

  it("stop() from any state returns to IDLE", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    client.stop();
    expect(client.state).toBe("IDLE");
  });

  it("stop() cancels pending reconnect timer", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateClose();
    expect(client.state).toBe("RECONNECTING");
    client.stop();
    clock.tick(10_000);
    expect(client.state).toBe("IDLE");   // no auto-reconnect after stop
  });

  it("setUrl() with new value while OPEN tears down and reconnects", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    client.setUrl("otherhost:9999");
    expect(client.state).toBe("CONNECTING");
    expect(lastSocket()!.url).toContain("otherhost:9999");
  });

  it("setUrl() with same value is a noop", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    const before = lastSocket();
    client.setUrl("localhost:3850");
    expect(lastSocket()).toBe(before);
    expect(client.state).toBe("OPEN");
  });

  it("setUrl() with invalid URL transitions to DISABLED", () => {
    const { client } = makeClient();
    client.start();
    client.setUrl("not a valid url");
    expect(client.state).toBe("DISABLED");
  });

  it("resume() from DISABLED → CONNECTING", () => {
    const { client } = makeClient();
    client.start();
    client.setUrl("bad url");
    expect(client.state).toBe("DISABLED");
    client.setUrl("goodhost:3850");   // valid url resumes
    expect(client.state).toBe("CONNECTING");
  });

  it("wsFactory throwing transitions CONNECTING → RECONNECTING", () => {
    const bus = new EventBus();
    const log = new Logger({ bus, writer: () => {} });
    const clock = new FakeClock();
    const client = new DaemonClient({
      bus, log, clock,
      wsFactory: () => { throw new Error("socket construction failed"); },
      disableHeartbeat: true,
      disableBreaker: true,
    });
    client.setUrl("h:1");
    client.start();
    expect(client.state).toBe("RECONNECTING");
  });

  it("double start() is idempotent", () => {
    const { client } = makeClient();
    client.start();
    const stateA = client.state;
    client.start();
    expect(client.state).toBe(stateA);
  });

  it("emits daemon:state on every transition", () => {
    const { client, bus, lastSocket } = makeClient();
    const events: any[] = [];
    bus.on("daemon:state", (e) => events.push(e));
    client.start();
    lastSocket()!.simulateOpen();
    lastSocket()!.simulateClose();
    expect(events.map((e) => [e.from, e.to])).toEqual([
      ["IDLE", "CONNECTING"],
      ["CONNECTING", "OPEN"],
      ["OPEN", "RECONNECTING"],
    ]);
  });

  it("send() returns {ok:false, reason:'idle'} when IDLE", () => {
    const { client } = makeClient();
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: false, reason: "idle" });
  });

  it("send() returns {ok:false, reason:'connecting'} when CONNECTING", () => {
    const { client } = makeClient();
    client.start();
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: false, reason: "connecting" });
  });

  it("send() returns {ok:true} when OPEN and calls socket.send()", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: true });
    expect(lastSocket()!.send).toHaveBeenCalled();
  });

  it("send() returns {ok:false, reason:'disabled'} when DISABLED", () => {
    const { client } = makeClient();
    client.start();
    client.setUrl("bad");
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: false, reason: "disabled" });
  });

  it("send() throwing inside socket.send returns connection_lost and transitions", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    lastSocket()!.send = vi.fn(() => { throw new Error("closed"); }) as any;
    const r = client.send({ url: "u", headers: [], cookies: [] });
    expect(r).toEqual({ ok: false, reason: "connection_lost" });
    expect(client.state).toBe("RECONNECTING");
  });

  it("self-transition to non-IDLE state is a noop (duplicate onopen ignored)", () => {
    const { client, lastSocket } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    expect(client.state).toBe("OPEN");
    // Fire onopen again — triggers OPEN→OPEN self-transition which must be a noop.
    lastSocket()!.simulateOpen();
    expect(client.state).toBe("OPEN");
  });

  it("url getter returns the normalized URL after setUrl()", () => {
    const { client } = makeClient();
    expect(client.url).toBe("localhost:3850");
    client.start();
    client.setUrl("otherhost:9001");
    expect(client.url).toBe("otherhost:9001");
  });

});
