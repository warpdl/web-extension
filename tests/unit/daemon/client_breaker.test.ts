import { describe, it, expect } from "vitest";
import { DaemonClient } from "../../../src/daemon/client";
import { EventBus } from "../../../src/core/events";
import { Logger } from "../../../src/core/logger";
import { FakeClock } from "../../fixtures/fake_clock";
import { makeWsFactory } from "../../fixtures/fake_websocket";

function makeClient(threshold = 3) {
  const bus = new EventBus();
  const log = new Logger({ bus, writer: () => {} });
  const clock = new FakeClock();
  const { factory, lastSocket } = makeWsFactory();
  const client = new DaemonClient({
    bus, log, clock,
    wsFactory: factory as unknown as (u: string) => WebSocket,
    disableHeartbeat: true,
    breakerThreshold: threshold,
  });
  client.setUrl("h:1");
  return { client, lastSocket, clock, bus };
}

describe("DaemonClient circuit breaker", () => {
  it("trips to DISABLED after threshold consecutive failures", () => {
    const { client, lastSocket, clock } = makeClient(3);
    client.start();
    for (let i = 0; i < 3; i++) {
      lastSocket()!.simulateClose();
      clock.tick(60_000);
    }
    expect(client.state).toBe("DISABLED");
  });

  it("successful open resets failure counter", () => {
    const { client, lastSocket, clock } = makeClient(3);
    client.start();
    lastSocket()!.simulateClose();           // fail 1
    clock.tick(60_000);                       // → CONNECTING
    lastSocket()!.simulateClose();           // fail 2
    clock.tick(60_000);                       // → CONNECTING
    lastSocket()!.simulateOpen();            // reset
    lastSocket()!.simulateClose();           // fail 1 again
    clock.tick(60_000);
    lastSocket()!.simulateClose();           // fail 2
    clock.tick(60_000);
    expect(client.state).not.toBe("DISABLED");
  });

  it("resume() from DISABLED transitions to CONNECTING", () => {
    const { client, lastSocket, clock } = makeClient(2);
    client.start();
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    expect(client.state).toBe("DISABLED");
    client.resume();
    expect(client.state).toBe("CONNECTING");
  });

  it("setUrl() with new value exits DISABLED", () => {
    const { client, lastSocket, clock } = makeClient(2);
    client.start();
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    expect(client.state).toBe("DISABLED");
    client.setUrl("other:2");
    expect(client.state).toBe("CONNECTING");
  });

  it("breaker emits state transition to DISABLED with cause breaker_tripped", () => {
    const { client, bus, lastSocket, clock } = makeClient(1);
    const events: any[] = [];
    bus.on("daemon:state", (e) => events.push(e));
    client.start();
    lastSocket()!.simulateClose();
    clock.tick(60_000);
    const disabled = events.find((e) => e.to === "DISABLED");
    expect(disabled?.cause).toBe("breaker_tripped");
  });

  it("DISABLED state tears down socket", () => {
    const { client, lastSocket, clock } = makeClient(1);
    client.start();
    const ws = lastSocket()!;
    ws.simulateClose();
    clock.tick(60_000);
    expect(client.state).toBe("DISABLED");
    expect(ws.close).toHaveBeenCalled();
  });
});
