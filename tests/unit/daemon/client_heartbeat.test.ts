import { describe, it, expect, vi } from "vitest";
import { DaemonClient } from "../../../src/daemon/client";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";
import { FakeClock } from "../../fixtures/fake_clock";
import { makeWsFactory } from "../../fixtures/fake_websocket";

function makeClient() {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const clock = new FakeClock();
  const { factory, lastSocket } = makeWsFactory();
  const client = new DaemonClient({
    bus,
    log,
    clock,
    wsFactory: factory as unknown as (u: string) => WebSocket,
    heartbeatMs: 20_000,
    disableBreaker: true,
  });
  client.setUrl("h:1");
  return { client, lastSocket, clock };
}

describe("DaemonClient heartbeat", () => {
  it("sends a ping frame every heartbeatMs while OPEN", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    clock.tick(20_000);
    const sendMock = lastSocket()!.send;
    expect(sendMock).toHaveBeenCalledWith('{"type":"ping"}');
    clock.tick(20_000);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("does not send pings when not OPEN", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    clock.tick(60_000);
    expect(lastSocket()!.send).not.toHaveBeenCalled();
  });

  it("stops sending pings after leaving OPEN", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    clock.tick(20_000);
    const ws = lastSocket()!;          // capture reference before close triggers reconnect
    lastSocket()!.simulateClose();
    const before = ws.send.mock.calls.length;
    clock.tick(60_000);
    // No new sends on the closed socket.
    expect(ws.send.mock.calls.length).toBe(before);
  });

  it("transitions to RECONNECTING when bufferedAmount stays >0 across two ticks", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    const ws = lastSocket()!;
    ws.simulateOpen();
    ws.bufferedAmount = 1024;
    clock.tick(20_000);   // first tick: capture buffered
    clock.tick(20_000);   // second tick: still >0 → force-close
    expect(client.state).toBe("RECONNECTING");
  });

  it("does NOT transition when bufferedAmount drains before second tick", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    const ws = lastSocket()!;
    ws.simulateOpen();
    ws.bufferedAmount = 1024;
    clock.tick(20_000);   // first tick: buffered
    ws.bufferedAmount = 0;
    clock.tick(20_000);   // second tick: drained
    expect(client.state).toBe("OPEN");
  });

  it("heartbeat send throwing transitions to RECONNECTING", () => {
    const { client, lastSocket, clock } = makeClient();
    client.start();
    lastSocket()!.simulateOpen();
    lastSocket()!.send = vi.fn(() => { throw new Error("socket closed"); }) as any;
    clock.tick(20_000);
    expect(client.state).toBe("RECONNECTING");
  });

  it("heartbeat disabled via option does nothing", () => {
    const bus = new EventBus();
    const log = new Logger({ bus, writer: () => {} });
    const clock = new FakeClock();
    const { factory, lastSocket } = makeWsFactory();
    const client = new DaemonClient({
      bus, log, clock,
      wsFactory: factory as unknown as (u: string) => WebSocket,
      disableHeartbeat: true,
      disableBreaker: true,
    });
    client.setUrl("h:1");
    client.start();
    lastSocket()!.simulateOpen();
    clock.tick(60_000);
    expect(lastSocket()!.send).not.toHaveBeenCalled();
  });
});
