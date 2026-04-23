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
  it("extracts hash from mobile plasma variant", () => {
    expect(extractPlayerHash("/s/player/plaz123/player-plasma-ias-phone-en_US.vflset/base.js")).toBe("plaz123");
  });
  it("extracts hash from tv variant", () => {
    expect(extractPlayerHash("/s/player/tv456/tv-player-ias.vflset/tv-player-ias.js")).toBe("tv456");
  });
  it("returns null for unrelated URL", () => {
    expect(extractPlayerHash("https://www.youtube.com/other.js")).toBeNull();
  });
});

describe("findBaseJsUrl — ytcfg strategies", () => {
  afterEach(() => {
    delete (window as any).ytcfg;
  });

  it("uses ytcfg.get('PLAYER_JS_URL') when present", () => {
    (window as any).ytcfg = { get: (k: string) => k === "PLAYER_JS_URL" ? "/s/player/cfg1/player_ias.vflset/en_US/base.js" : undefined };
    const url = findBaseJsUrl();
    expect(url).toContain("/s/player/cfg1/");
    expect(url).toContain("base.js");
  });

  it("uses ytcfg.data_.PLAYER_JS_URL fallback", () => {
    (window as any).ytcfg = { data_: { PLAYER_JS_URL: "https://www.youtube.com/s/player/cfg2/player_ias.vflset/en_US/base.js" } };
    expect(findBaseJsUrl()).toContain("/s/player/cfg2/");
  });

  it("prefers ytcfg.get over data_", () => {
    (window as any).ytcfg = {
      get: () => "/s/player/primary/player_ias.vflset/en_US/base.js",
      data_: { PLAYER_JS_URL: "/s/player/secondary/player_ias.vflset/en_US/base.js" },
    };
    expect(findBaseJsUrl()).toContain("primary");
  });

  it("prefers ytcfg over <script> scan", () => {
    (window as any).ytcfg = { get: () => "/s/player/fromcfg/player_ias.vflset/en_US/base.js" };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/s/player/fromscript/player_ias.vflset/en_US/base.js";
    document.head.appendChild(s);
    expect(findBaseJsUrl()).toContain("fromcfg");
  });
});

describe("findBaseJsUrl — preload link fallback", () => {
  it("finds base.js from <link rel=preload>", () => {
    const l = document.createElement("link");
    l.rel = "preload";
    l.href = "https://www.youtube.com/s/player/preloaded/player_ias.vflset/en_US/base.js";
    document.head.appendChild(l);
    expect(findBaseJsUrl()).toContain("preloaded");
  });
});

describe("findBaseJsUrl — base.js with query string", () => {
  it("matches base.js URL with cache-bust query", () => {
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/s/player/q1/player_ias.vflset/en_US/base.js?cb=123";
    document.head.appendChild(s);
    expect(findBaseJsUrl()).toContain("q1");
  });

  it("matches mobile plasma variant", () => {
    const s = document.createElement("script");
    s.src = "https://m.youtube.com/s/player/mob1/player-plasma-ias-phone-en_US.vflset/base.js";
    document.head.appendChild(s);
    expect(findBaseJsUrl()).toContain("mob1");
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

  it("falls through to fetch when chrome.storage.local.get throws", async () => {
    // Exercises line 37: catch block when chrome.storage.get throws
    const body = "var fallback = 1;";
    (globalThis as any).chrome.storage.local.get = vi.fn(async () => {
      throw new Error("storage unavailable");
    });
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, text: async () => body }));
    const result = await loadBaseJs("https://www.youtube.com/s/player/catchtest/player_ias.vflset/en_US/base.js");
    expect(result).toBe(body);
    expect((globalThis as any).fetch).toHaveBeenCalled();
  });

  it("silently ignores chrome.storage.local.set failure", async () => {
    // Exercises line 48: catch block when chrome.storage.set throws
    const body = "var persist = 2;";
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, text: async () => body }));
    (globalThis as any).chrome.storage.local.set = vi.fn(async () => {
      throw new Error("storage write failed");
    });
    // Should not throw — persistence failure is silently ignored
    const result = await loadBaseJs("https://www.youtube.com/s/player/setfail/player_ias.vflset/en_US/base.js");
    expect(result).toBe(body);
  });
});
