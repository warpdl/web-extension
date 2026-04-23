import { vi } from "vitest";

export class FakeWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  readyState: 0 | 1 | 2 | 3 = 0;
  bufferedAmount = 0;
  url: string;

  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;

  send = vi.fn((_data: string) => {
    /* tests can override via spy */
  });
  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = 3;
    setTimeout(() => this.onclose?.({ code: code ?? 1000, reason: reason ?? "", type: "close", wasClean: true } as unknown as CloseEvent), 0);
  });

  constructor(url: string) {
    this.url = url;
  }

  // Test-only API

  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  simulateClose(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason, type: "close", wasClean: true } as unknown as CloseEvent);
  }

  simulateError(): void {
    this.onerror?.(new Event("error"));
  }

  simulateMessage(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

export function makeWsFactory(): {
  factory: (url: string) => FakeWebSocket;
  lastSocket(): FakeWebSocket | null;
  allSockets(): FakeWebSocket[];
} {
  const sockets: FakeWebSocket[] = [];
  const factory = (url: string): FakeWebSocket => {
    const s = new FakeWebSocket(url);
    sockets.push(s);
    return s;
  };
  return {
    factory,
    lastSocket: () => sockets[sockets.length - 1] ?? null,
    allSockets: () => sockets,
  };
}
