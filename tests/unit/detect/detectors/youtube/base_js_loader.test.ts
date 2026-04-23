// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadBaseJs, extractPlayerHash, findBaseJsUrl, __resetMemCache } from "../../../../../src/detect/detectors/youtube/base_js_loader";

beforeEach(() => {
  __resetMemCache();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe("extractPlayerHash", () => {
  it("extracts hash from standard YouTube URL", () => {
    expect(extractPlayerHash("https://www.youtube.com/s/player/abcd1234/player_ias.vflset/en_US/base.js")).toBe("abcd1234");
  });
  it("extracts hash from variant path", () => {
    expect(extractPlayerHash("/s/player/xyz567/player_ias.vflset/en_US/base.js")).toBe("xyz567");
  });
  it("returns null for unrelated URL", () => {
    expect(extractPlayerHash("https://www.youtube.com/other.js")).toBeNull();
  });
});

describe("findBaseJsUrl", () => {
  it("finds script src pointing to base.js", () => {
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/s/player/abcd/player_ias.vflset/en_US/base.js";
    document.head.appendChild(s);
    expect(findBaseJsUrl()).toBe("https://www.youtube.com/s/player/abcd/player_ias.vflset/en_US/base.js");
  });
  it("returns null when no matching script", () => {
    expect(findBaseJsUrl()).toBeNull();
  });
});

describe("loadBaseJs", () => {
  it("fetches and returns body on cache miss", async () => {
    const body = "var x = 1;";
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, text: async () => body }));
    const result = await loadBaseJs("https://www.youtube.com/s/player/abcd1234/player_ias.vflset/en_US/base.js");
    expect(result).toBe(body);
    expect((globalThis as any).fetch).toHaveBeenCalledOnce();
  });

  it("returns from in-memory cache on second call", async () => {
    const body = "var y = 2;";
    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => body }));
    (globalThis as any).fetch = fetchFn;
    const url = "https://www.youtube.com/s/player/abcd1234/player_ias.vflset/en_US/base.js";
    await loadBaseJs(url);
    await loadBaseJs(url);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("returns from chrome.storage cache if not expired", async () => {
    const body = "var z = 3;";
    const nowMs = Date.now();
    (globalThis as any).chrome.storage.local.get = vi.fn(async () => ({
      "yt_base_js:abcd1234": { body, storedAt: nowMs - 1000 },
    }));
    (globalThis as any).fetch = vi.fn();
    const url = "https://www.youtube.com/s/player/abcd1234/player_ias.vflset/en_US/base.js";
    const result = await loadBaseJs(url);
    expect(result).toBe(body);
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it("ignores expired chrome.storage cache (>24h)", async () => {
    const body = "var w = 4;";
    (globalThis as any).chrome.storage.local.get = vi.fn(async () => ({
      "yt_base_js:abcd1234": { body: "stale", storedAt: Date.now() - 25 * 60 * 60 * 1000 },
    }));
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, text: async () => body }));
    const url = "https://www.youtube.com/s/player/abcd1234/player_ias.vflset/en_US/base.js";
    const result = await loadBaseJs(url);
    expect(result).toBe(body);
  });

  it("throws when fetch returns non-ok", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    await expect(
      loadBaseJs("https://www.youtube.com/s/player/hhh/player_ias.vflset/en_US/base.js")
    ).rejects.toThrow();
  });

  it("persists fetched body to chrome.storage.local", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, text: async () => "body" }));
    const setSpy = (globalThis as any).chrome.storage.local.set = vi.fn(async () => undefined);
    await loadBaseJs("https://www.youtube.com/s/player/qqq/player_ias.vflset/en_US/base.js");
    expect(setSpy).toHaveBeenCalled();
  });

  it("throws when URL has no extractable hash", async () => {
    await expect(loadBaseJs("https://www.youtube.com/not-base.js")).rejects.toThrow();
  });
});
