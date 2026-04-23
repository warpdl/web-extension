export type State = "IDLE" | "CONNECTING" | "OPEN" | "RECONNECTING" | "DISABLED";

export const TRANSITIONS: Readonly<Record<State, ReadonlySet<State>>> = Object.freeze({
  IDLE:         Object.freeze(new Set<State>(["CONNECTING", "IDLE"])),
  CONNECTING:   Object.freeze(new Set<State>(["OPEN", "RECONNECTING", "IDLE"])),
  OPEN:         Object.freeze(new Set<State>(["RECONNECTING", "IDLE"])),
  RECONNECTING: Object.freeze(new Set<State>(["CONNECTING", "DISABLED", "IDLE"])),
  DISABLED:     Object.freeze(new Set<State>(["CONNECTING", "IDLE"])),
});

export function isLegalTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].has(to);
}
