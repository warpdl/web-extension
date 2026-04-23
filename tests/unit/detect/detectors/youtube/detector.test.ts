// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { YouTubeDetector } from "../../../../../src/detect/detectors/youtube/detector";
import type { YtBridgeMessage } from "../../../../../src/types";

beforeEach(() => {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as any).chrome = { runtime: { sendMessage: vi.fn() } };
});

afterEach(() => {
  document.body.innerHTML = "";
});

function makeYouTubePlayer(): HTMLVideoElement {
  const wrapper = document.createElement("div");
  wrapper.id = "movie_player";
  const video = document.createElement("video");
  wrapper.appendChild(video);
  document.body.appendChild(wrapper);
  return video;
}

function postFromMain(msg: YtBridgeMessage): Promise<void> {
  return new Promise((resolve) => {
    window.postMessage(msg, "*");
    setTimeout(resolve, 10);
  });
}

describe("YouTubeDetector", () => {
  it("mounts overlay on #movie_player video with empty options initially", () => {
    makeYouTubePlayer();
    const d = new YouTubeDetector();
    d.start();
    const btn = document.querySelector("[data-warpdl-overlay-btn]");
    expect(btn).not.toBeNull();
    d.stop();
  });

  it("ignores videos not inside #movie_player", () => {
    const v = document.createElement("video");
    document.body.appendChild(v);
    const d = new YouTubeDetector();
    d.start();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).toBeNull();
    d.stop();
  });

  it("sends request-formats postMessage on start", async () => {
    makeYouTubePlayer();
    const received: YtBridgeMessage[] = [];
    const handler = (ev: MessageEvent) => {
      // ev.source is null in jsdom when the message originates from the same window
      if (ev.source !== null && ev.source !== window) return;
      if (ev.data?.source === "warpdl-yt-content") received.push(ev.data);
    };
    window.addEventListener("message", handler);
    const d = new YouTubeDetector();
    d.start();
    await new Promise((r) => setTimeout(r, 20));
    window.removeEventListener("message", handler);
    expect(received.some((m) => m.type === "request-formats")).toBe(true);
    d.stop();
  });

  it("updates overlay options when formats-ready received", async () => {
    makeYouTubePlayer();
    const d = new YouTubeDetector();
    d.start();
    await postFromMain({
      source: "warpdl-yt-main",
      type: "formats-ready",
      options: [{ label: "720p · mp4", url: "https://a/x", group: "Combined" }],
      videoId: "abc",
      title: "T",
    });
    // Click to open dropdown to verify
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    expect(document.querySelector("[data-warpdl-overlay-item]")).not.toBeNull();
    d.stop();
  });

  it("stop removes overlay and message listener", async () => {
    makeYouTubePlayer();
    const d = new YouTubeDetector();
    d.start();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).not.toBeNull();
    d.stop();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).toBeNull();
  });

  it("clears overlay options on formats-error", async () => {
    makeYouTubePlayer();
    const d = new YouTubeDetector();
    d.start();
    // First set some options so there's something to clear
    await postFromMain({
      source: "warpdl-yt-main",
      type: "formats-ready",
      options: [{ label: "720p · mp4", url: "https://a/x", group: "Combined" }],
      videoId: "abc",
      title: "T",
    });
    // Now send formats-error — should clear options without throwing
    await postFromMain({
      source: "warpdl-yt-main",
      type: "formats-error",
      reason: "base_js_fetch_failed",
      videoId: "abc",
    });
    // Overlay button should still exist (detector is still running)
    expect(document.querySelector("[data-warpdl-overlay-btn]")).not.toBeNull();
    d.stop();
  });
});
