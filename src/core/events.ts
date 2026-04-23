import type { CapturedDownload, ExtensionSettings } from "../types";
import type { State } from "../daemon/state";

export interface Events {
  "daemon:state": { from: State; to: State; cause?: string };
  "daemon:error": { where: string; cause: unknown };
  "daemon:message": { payload: CapturedDownload };
  "send:outcome": { kind: "sent" | "fallback" | "drop"; reason?: string };
  "settings:changed": { settings: ExtensionSettings };
  "settings:applied": { url: string; interceptEnabled: boolean };
  "log:entry": { level: "debug" | "info" | "warn" | "error"; scope: string; msg: string; ctx?: Record<string, unknown> };
}

type Handler<K extends keyof Events> = (payload: Events[K]) => void;
type Unsubscribe = () => void;

export class EventBus {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(evt: K, cb: Handler<K>): Unsubscribe {
    let set = this.handlers.get(evt);
    if (!set) {
      set = new Set();
      this.handlers.set(evt, set);
    }
    set.add(cb as Handler<any>);
    return () => {
      set!.delete(cb as Handler<any>);
    };
  }

  emit<K extends keyof Events>(evt: K, payload: Events[K]): void {
    const set = this.handlers.get(evt);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch {
        // Subscriber errors are isolated; don't break other subscribers.
        // (Logger will capture via unhandled-error path later.)
      }
    }
  }
}
