// NOTE: we don't import Clock from tests/. Re-declare it for production code.
// Tests pass a compatible shape.

interface ClockLike {
  now(): number;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface CapturedHeader {
  name: string;
  value: string | undefined;
}

interface Entry {
  headers: CapturedHeader[];
  expiresAt: number;
}

interface Opts {
  clock: ClockLike;
  ttlMs?: number;
  sweepMs?: number;
  cap?: number;
}

export class HeaderStore {
  private map = new Map<string, Entry>();
  private clock: ClockLike;
  private ttlMs: number;
  private sweepMs: number;
  private cap: number;
  private sweepTimer: number | null = null;

  constructor(opts: Opts) {
    this.clock = opts.clock;
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.sweepMs = opts.sweepMs ?? 30_000;
    this.cap = opts.cap ?? 1000;
  }

  set(url: string, headers: CapturedHeader[]): void {
    if (this.map.has(url)) this.map.delete(url);    // re-insert to move to end (LRU tail = most recent)
    this.map.set(url, { headers, expiresAt: this.clock.now() + this.ttlMs });
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get(url: string): CapturedHeader[] | undefined {
    const e = this.map.get(url);
    if (!e) return undefined;
    if (e.expiresAt <= this.clock.now()) {
      this.map.delete(url);
      return undefined;
    }
    // LRU bump
    this.map.delete(url);
    this.map.set(url, e);
    return e.headers;
  }

  delete(url: string): void {
    this.map.delete(url);
  }

  migrate(oldUrl: string, newUrl: string): void {
    const e = this.map.get(oldUrl);
    if (!e) return;
    this.map.delete(oldUrl);
    this.map.set(newUrl, e);
  }

  size(): number {
    return this.map.size;
  }

  sweep(): void {
    const now = this.clock.now();
    for (const [url, e] of this.map) {
      if (e.expiresAt <= now) this.map.delete(url);
    }
  }

  startSweep(): void {
    if (this.sweepTimer !== null) return;
    this.sweepTimer = this.clock.setInterval(() => this.sweep(), this.sweepMs);
  }

  stopSweep(): void {
    if (this.sweepTimer !== null) {
      this.clock.clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
