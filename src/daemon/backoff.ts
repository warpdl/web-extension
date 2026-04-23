const MIN_FLOOR_MS = 100;
const BASE_MS = 1000;
const CAP_MS = 30_000;
const JITTER_RATIO = 0.15;   // ±15%

export function nextDelay(attempt: number): number {
  const exp = Math.max(0, attempt);
  const base = Math.min(BASE_MS * 2 ** exp, CAP_MS);
  const jitter = (Math.random() - 0.5) * 2 * base * JITTER_RATIO;
  return Math.max(MIN_FLOOR_MS, Math.round(base + jitter));
}
