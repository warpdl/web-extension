import { vi } from "vitest";

type Listener<T extends (...args: any[]) => any> = T;

function mkEvent<T extends (...args: any[]) => any>() {
  const listeners: Listener<T>[] = [];
  return {
    addListener: (l: T) => listeners.push(l),
    removeListener: (l: T) => {
      const i = listeners.indexOf(l);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (l: T) => listeners.includes(l),
    fire: (...args: Parameters<T>) => {
      for (const l of listeners) l(...args);
    },
    listeners: () => listeners.slice(),
  };
}

function mkStorageArea() {
  const data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys === undefined || keys === null) return { ...data };
      if (typeof keys === "string") return keys in data ? { [keys]: data[keys] } : {};
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (k in data) out[k] = data[k];
        return out;
      }
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(keys)) out[k] = k in data ? data[k] : (keys as any)[k];
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) delete data[k];
    }),
    clear: vi.fn(async () => {
      for (const k of Object.keys(data)) delete data[k];
    }),
    _raw: data,
  };
}

export function makeChromeMock() {
  const mock = {
    runtime: {
      onMessage: mkEvent<(msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void>(),
      onInstalled: mkEvent<(details: { reason: string }) => void>(),
      onConnect: mkEvent<(port: unknown) => void>(),
      sendMessage: vi.fn(async () => undefined),
      connect: vi.fn(() => ({
        onMessage: mkEvent<(msg: unknown) => void>(),
        onDisconnect: mkEvent<() => void>(),
        postMessage: vi.fn(),
        disconnect: vi.fn(),
      })),
      lastError: undefined as undefined | { message: string },
    },
    downloads: {
      onCreated: mkEvent<(item: { id: number; url: string; finalUrl?: string; filename?: string }) => void>(),
      cancel: vi.fn(async (_id: number) => undefined),
      erase: vi.fn(async (_query: { id: number }) => undefined),
      download: vi.fn(async (_opts: { url: string; filename?: string }) => 1),
    },
    cookies: {
      getAll: vi.fn(async (_q: { url: string }) => [] as chrome.cookies.Cookie[]),
    },
    storage: {
      sync: mkStorageArea(),
      local: mkStorageArea(),
      onChanged: mkEvent<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>(),
    },
    webRequest: {
      onBeforeSendHeaders: mkEvent<(details: { url: string; requestHeaders?: { name: string; value?: string }[] }) => void>(),
      onBeforeRedirect: mkEvent<(details: { url: string; redirectUrl: string }) => void>(),
      onCompleted: mkEvent<(details: { url: string }) => void>(),
      onErrorOccurred: mkEvent<(details: { url: string }) => void>(),
    },
    tabs: {
      create: vi.fn(async (_opts: { url: string }) => ({ id: 1 })),
    },
  };
  return mock;
}

export type ChromeMock = ReturnType<typeof makeChromeMock>;

export function installChromeMock(): ChromeMock {
  const mock = makeChromeMock();
  (globalThis as any).chrome = mock;
  return mock;
}

export function uninstallChromeMock(): void {
  delete (globalThis as any).chrome;
}
