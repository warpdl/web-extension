// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runMainWorld } from "../../../../../src/detect/detectors/youtube/main_world";

let cleanup: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  // Remove any lingering script tags from previous tests
  Array.from(document.head.querySelectorAll("script")).forEach((s) => s.remove());
  delete (window as any).ytInitialPlayerResponse;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
  };
  (globalThis as any).fetch = vi.fn();
});

afterEach(() => {
  if (cleanup) cleanup();
  cleanup = null;
  delete (globalThis as any).fetch;
});

function listenForMessage(source: string, type?: string): Promise<any> {
  return new Promise((resolve) => {
    const handler = (ev: MessageEvent) => {
      // ev.source is null in jsdom when the message originates from the same window
      if (ev.source !== null && ev.source !== window) return;
      if (ev.data?.source !== source) return;
      if (type && ev.data?.type !== type) return;
      window.removeEventListener("message", handler);
      resolve(ev.data);
    };
    window.addEventListener("message", handler);
  });
}

describe("runMainWorld", () => {
  it("sends ready on startup", async () => {
    const ready = listenForMessage("warpdl-yt-main", "ready");
    cleanup = runMainWorld();
    const msg = await ready;
    expect(msg.type).toBe("ready");
  });

  it("responds to request-formats with formats-error when no player response", async () => {
    cleanup = runMainWorld();
    const errMsg = listenForMessage("warpdl-yt-main", "formats-error");
    window.postMessage({ source: "warpdl-yt-content", type: "request-formats" }, "*");
    const msg = await errMsg;
    expect(msg.type).toBe("formats-error");
    expect(msg.reason).toBe("no_player_response");
  });

  it("ignores messages from other sources", async () => {
    cleanup = runMainWorld();
    let called = false;
    const handler = (ev: MessageEvent) => {
      if (ev.data?.source === "warpdl-yt-main" && ev.data?.type === "formats-error") called = true;
    };
    window.addEventListener("message", handler);
    window.postMessage({ source: "other-extension", type: "request-formats" }, "*");
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener("message", handler);
    expect(called).toBe(false);
  });

  it("emits formats-ready when player response present", async () => {
    (window as any).ytInitialPlayerResponse = {
      videoDetails: { videoId: "abc", title: "T", lengthSeconds: "1", author: "A" },
      streamingData: {
        formats: [{ url: "https://a/x.mp4", mimeType: "video/mp4", qualityLabel: "720p" }],
      },
    };
    // Inject fake base.js script tag so findBaseJsUrl succeeds
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/s/player/abc/player_ias.vflset/en_US/base.js";
    document.head.appendChild(script);
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      text: async () => `
        var Xz={xb:function(a,b){a.reverse()}};
        var sigDecode=function(a){a=a.split("");Xz.xb(a,1);return a.join("")};
        a.set("alr","yes");c&&(c=sigDecode(decodeURIComponent(c)));
        var nDecode=function(b){return b};
        &&(b=a.get("n"))&&(b=nDecode(b));
      `,
    }));

    cleanup = runMainWorld();
    const ready = listenForMessage("warpdl-yt-main", "formats-ready");
    window.postMessage({ source: "warpdl-yt-content", type: "request-formats" }, "*");
    const msg = await ready;
    expect(msg.type).toBe("formats-ready");
    expect(msg.videoId).toBe("abc");
    expect(msg.options.length).toBeGreaterThan(0);
  });

  it("emits base_js_fetch_failed when fetch fails", async () => {
    (window as any).ytInitialPlayerResponse = {
      videoDetails: { videoId: "abc", title: "T", lengthSeconds: "1", author: "A" },
      streamingData: { formats: [{ url: "https://a/x.mp4", mimeType: "video/mp4" }] },
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/s/player/fail/player_ias.vflset/en_US/base.js";
    document.head.appendChild(script);
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 500 }));

    cleanup = runMainWorld();
    const errMsg = listenForMessage("warpdl-yt-main", "formats-error");
    window.postMessage({ source: "warpdl-yt-content", type: "request-formats" }, "*");
    const msg = await errMsg;
    expect(msg.type).toBe("formats-error");
    expect(msg.reason).toBe("base_js_fetch_failed");
  });

  it("emits decode_exception when more than 50% of formats fail to decode", async () => {
    (window as any).ytInitialPlayerResponse = {
      videoDetails: { videoId: "abc", title: "T", lengthSeconds: "1", author: "A" },
      streamingData: {
        formats: [
          { url: "https://a/ok.mp4", mimeType: "video/mp4", qualityLabel: "720p" },
          { mimeType: "video/mp4", qualityLabel: "1080p" }, // no url, no cipher — fails
          { mimeType: "video/mp4", qualityLabel: "480p" },  // no url, no cipher — fails
        ],
      },
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/s/player/decfail/player_ias.vflset/en_US/base.js";
    document.head.appendChild(script);
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      text: async () => `
        var Xz={xb:function(a,b){a.reverse()}};
        var sigDecode=function(a){a=a.split("");Xz.xb(a,1);return a.join("")};
        a.set("alr","yes");c&&(c=sigDecode(decodeURIComponent(c)));
        var nDecode=function(b){return b};
        &&(b=a.get("n"))&&(b=nDecode(b));
      `,
    }));

    cleanup = runMainWorld();
    const errMsg = listenForMessage("warpdl-yt-main", "formats-error");
    window.postMessage({ source: "warpdl-yt-content", type: "request-formats" }, "*");
    const msg = await errMsg;
    expect(msg.type).toBe("formats-error");
    expect(msg.reason).toBe("decode_exception");
  });
});
