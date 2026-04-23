// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { YouTubeDetector } from "../../../../../src/detect/detectors/youtube/detector";
import type { ResolveYtUrlResponse } from "../../../../../src/types";

let sendMessageSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  sendMessageSpy = vi.fn();
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: sendMessageSpy,
    },
  };
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

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("YouTubeDetector (daemon-backed)", () => {
  it("mounts overlay on #movie_player video", () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue({ ok: false, error: "test" } as ResolveYtUrlResponse);
    const d = new YouTubeDetector();
    d.start();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).not.toBeNull();
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

  it("calls RESOLVE_YT_URL on start with the current location.href", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue({ ok: true, result: { title: "t", formats: [] } } as ResolveYtUrlResponse);
    const d = new YouTubeDetector();
    d.start();
    await flush();
    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: "RESOLVE_YT_URL",
      pageUrl: window.location.href,
    });
    d.stop();
  });

  it("populates overlay with returned formats, grouped", async () => {
    makeYouTubePlayer();
    const resp: ResolveYtUrlResponse = {
      ok: true,
      result: {
        title: "My Video",
        formats: [
          {
            formatId: "22",
            url: "https://a/video22.mp4",
            ext: "mp4",
            hasVideo: true,
            hasAudio: true,
            height: 720,
            quality: "720p",
            fileSize: 1048576,
          },
          {
            formatId: "137",
            url: "https://a/video137.mp4",
            ext: "mp4",
            hasVideo: true,
            hasAudio: false,
            height: 1080,
            quality: "1080p",
          },
          {
            formatId: "140",
            url: "https://a/audio140.m4a",
            ext: "m4a",
            hasVideo: false,
            hasAudio: true,
            audioBitrate: 128,
          },
        ],
      },
    };
    sendMessageSpy.mockResolvedValue(resp);

    const d = new YouTubeDetector();
    d.start();
    await flush();
    await flush();

    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const items = Array.from(document.querySelectorAll("[data-warpdl-overlay-item]"));
    expect(items.length).toBe(3);

    const headers = Array.from(document.querySelectorAll("[data-warpdl-overlay-group]")).map((h) => h.textContent);
    expect(headers).toContain("Combined");
    expect(headers).toContain("Video only");
    expect(headers).toContain("Audio only");

    d.stop();
  });

  it("renders no options on resolve failure (error logged)", async () => {
    makeYouTubePlayer();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendMessageSpy.mockResolvedValue({ ok: false, error: "yt-dlp not found", code: -32101 } as ResolveYtUrlResponse);

    const d = new YouTubeDetector();
    d.start();
    await flush();

    expect(warnSpy).toHaveBeenCalled();
    // No dropdown items when resolve failed — clicking the button opens
    // nothing (empty options list).
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    expect(document.querySelectorAll("[data-warpdl-overlay-item]").length).toBe(0);

    warnSpy.mockRestore();
    d.stop();
  });

  it("stop removes overlay", () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue({ ok: true, result: { title: "t", formats: [] } } as ResolveYtUrlResponse);
    const d = new YouTubeDetector();
    d.start();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).not.toBeNull();
    d.stop();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).toBeNull();
  });

  it("does not re-resolve when URL is unchanged", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue({ ok: true, result: { title: "t", formats: [] } } as ResolveYtUrlResponse);
    const d = new YouTubeDetector();
    d.start();
    await flush();
    document.dispatchEvent(new Event("yt-navigate-finish"));
    await new Promise((r) => setTimeout(r, 600));
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    d.stop();
  });

  it("re-resolves when SPA URL changes", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue({ ok: true, result: { title: "t", formats: [] } } as ResolveYtUrlResponse);
    const d = new YouTubeDetector();
    d.start();
    await flush();

    window.history.replaceState(null, "", "/watch?v=new");
    document.dispatchEvent(new Event("yt-navigate-finish"));
    await new Promise((r) => setTimeout(r, 600));

    // At least two calls total; the second should include the new URL.
    expect(sendMessageSpy).toHaveBeenCalled();
    const calledPageUrls = sendMessageSpy.mock.calls.map((args) => (args[0] as { pageUrl: string }).pageUrl);
    expect(calledPageUrls.some((u) => u.endsWith("/watch?v=new"))).toBe(true);
    d.stop();
  });
});
