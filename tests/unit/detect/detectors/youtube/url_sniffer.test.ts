// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  installSniffer,
  getCapturedUrl,
  getCapturedItags,
  onUrlCaptured,
  __resetSniffer,
} from "../../../../../src/detect/detectors/youtube/url_sniffer";

let origFetch: typeof window.fetch;
let origXhrOpen: typeof XMLHttpRequest.prototype.open;

beforeEach(() => {
  __resetSniffer();
  origFetch = window.fetch;
  origXhrOpen = XMLHttpRequest.prototype.open;
  // Stub fetch so the patched version has something to delegate to
  (window as any).fetch = vi.fn(async () => new Response("ok", { status: 200 }));
});

afterEach(() => {
  (window as any).fetch = origFetch;
  XMLHttpRequest.prototype.open = origXhrOpen;
});

describe("installSniffer", () => {
  it("is idempotent — multiple installs wrap once", () => {
    const innerFetch = vi.fn(async () => new Response("ok"));
    (window as any).fetch = innerFetch;
    installSniffer();
    installSniffer();
    installSniffer();
    // Call fetch with a googlevideo URL — should capture only once
    window.fetch("https://r1---sn-abc.googlevideo.com/videoplayback?itag=22&expire=1234");
    expect(getCapturedUrl(22)).toBeDefined();
  });

  it("captures URL from fetch call", async () => {
    installSniffer();
    await window.fetch("https://r1---sn-abc.googlevideo.com/videoplayback?itag=137&expire=123&n=abc");
    expect(getCapturedUrl(137)).toContain("itag=137");
  });

  it("captures URL from XMLHttpRequest.open", () => {
    installSniffer();
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://r1---sn-xyz.googlevideo.com/videoplayback?itag=140&expire=456");
    expect(getCapturedUrl(140)).toContain("itag=140");
  });

  it("ignores non-googlevideo URLs", async () => {
    installSniffer();
    await window.fetch("https://www.youtube.com/api/stats?itag=22");
    expect(getCapturedUrl(22)).toBeUndefined();
  });

  it("ignores googlevideo URLs without itag", async () => {
    installSniffer();
    await window.fetch("https://r1---sn-abc.googlevideo.com/something-else");
    expect(getCapturedItags()).toEqual([]);
  });

  it("stores only the first URL per itag (byte-range continuations don't overwrite)", async () => {
    installSniffer();
    const first = "https://r1.googlevideo.com/videoplayback?itag=137&n=first";
    const second = "https://r1.googlevideo.com/videoplayback?itag=137&n=second";
    await window.fetch(first);
    await window.fetch(second);
    expect(getCapturedUrl(137)).toBe(first);
  });

  it("captures URL when fetch is called with a URL object", async () => {
    installSniffer();
    await window.fetch(new URL("https://r1.googlevideo.com/videoplayback?itag=22&x=y"));
    expect(getCapturedUrl(22)).toContain("itag=22");
  });

  it("captures URL when fetch is called with a Request object", async () => {
    installSniffer();
    await window.fetch(new Request("https://r1.googlevideo.com/videoplayback?itag=248"));
    expect(getCapturedUrl(248)).toContain("itag=248");
  });

  it("rejects non-finite itag values", async () => {
    installSniffer();
    await window.fetch("https://r1.googlevideo.com/videoplayback?itag=NaN");
    expect(getCapturedItags()).toEqual([]);
  });
});

describe("onUrlCaptured", () => {
  it("fires listener when new URL is captured", async () => {
    installSniffer();
    const listener = vi.fn();
    onUrlCaptured(listener);
    await window.fetch("https://r1.googlevideo.com/videoplayback?itag=22");
    expect(listener).toHaveBeenCalledWith(22, expect.stringContaining("itag=22"));
  });

  it("does not fire listener for cached (already-captured) itag", async () => {
    installSniffer();
    const listener = vi.fn();
    onUrlCaptured(listener);
    await window.fetch("https://r1.googlevideo.com/videoplayback?itag=137&n=first");
    await window.fetch("https://r1.googlevideo.com/videoplayback?itag=137&n=second");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns unsubscribe function", async () => {
    installSniffer();
    const listener = vi.fn();
    const unsubscribe = onUrlCaptured(listener);
    unsubscribe();
    await window.fetch("https://r1.googlevideo.com/videoplayback?itag=22");
    expect(listener).not.toHaveBeenCalled();
  });

  it("listener errors do not break the fetch hook", async () => {
    installSniffer();
    onUrlCaptured(() => { throw new Error("listener fail"); });
    await expect(window.fetch("https://r1.googlevideo.com/videoplayback?itag=22")).resolves.toBeDefined();
    expect(getCapturedUrl(22)).toBeDefined();
  });
});

describe("getCapturedItags", () => {
  it("returns empty list when nothing captured", () => {
    installSniffer();
    expect(getCapturedItags()).toEqual([]);
  });

  it("returns captured itags in insertion order", async () => {
    installSniffer();
    await window.fetch("https://r1.googlevideo.com/videoplayback?itag=22");
    await window.fetch("https://r1.googlevideo.com/videoplayback?itag=137");
    await window.fetch("https://r1.googlevideo.com/videoplayback?itag=140");
    expect(getCapturedItags()).toEqual([22, 137, 140]);
  });
});
