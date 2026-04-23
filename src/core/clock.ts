export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms) as unknown as number,
  clearInterval: (id) => globalThis.clearInterval(id),
};
