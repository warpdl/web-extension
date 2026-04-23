export type State = "IDLE" | "CONNECTING" | "OPEN" | "RECONNECTING" | "DISABLED";

// Any running state can jump to DISABLED (setUrl with invalid URL) or to CONNECTING (setUrl change).
// DISABLED exits only via setUrl(valid) or resume(); stop() always returns to IDLE.
export const TRANSITIONS: Readonly<Record<State, ReadonlySet<State>>> = Object.freeze({
  IDLE:          Object.freeze(new Set<State>(["CONNECTING", "DISABLED", "IDLE"])),
  CONNECTING:    Object.freeze(new Set<State>(["OPEN", "RECONNECTING", "DISABLED", "IDLE"])),
  OPEN:          Object.freeze(new Set<State>(["RECONNECTING", "CONNECTING", "DISABLED", "IDLE"])),
  RECONNECTING:  Object.freeze(new Set<State>(["CONNECTING", "DISABLED", "IDLE"])),
  DISABLED:      Object.freeze(new Set<State>(["CONNECTING", "IDLE"])),
}) as Readonly<Record<State, ReadonlySet<State>>>;

export function isLegalTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].has(to);
}
