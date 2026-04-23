export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
}

interface Timer {
  id: number;
  fireAt: number;
  cb: () => void;
  interval?: number;
}

export class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private timers: Timer[] = [];

  now(): number {
    return this.currentTime;
  }

  setTimeout(cb: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, fireAt: this.currentTime + ms, cb });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  setInterval(cb: () => void, ms: number): number {
    if (ms <= 0) throw new Error("FakeClock.setInterval requires ms > 0");
    const id = this.nextId++;
    this.timers.push({ id, fireAt: this.currentTime + ms, cb, interval: ms });
    return id;
  }

  clearInterval(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  tick(ms: number): void {
    if (ms < 0) throw new Error("FakeClock.tick requires ms >= 0");
    const target = this.currentTime + ms;
    while (true) {
      const next = this.timers
        .filter((t) => t.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!next) break;
      this.currentTime = next.fireAt;
      next.cb();
      if (next.interval !== undefined) {
        next.fireAt += next.interval;
      } else {
        this.timers = this.timers.filter((t) => t.id !== next.id);
      }
    }
    this.currentTime = target;
  }

  pendingTimers(): number {
    return this.timers.length;
  }
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms) as unknown as number,
  clearInterval: (id) => globalThis.clearInterval(id),
};
