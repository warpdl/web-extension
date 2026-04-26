// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { YouTubeDetector } from "../../../../../src/detect/detectors/youtube/detector";
import type { ResolveYtUrlResponse, ResolvedFormat } from "../../../../../src/types";

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

function format(p: Partial<ResolvedFormat> & Pick<ResolvedFormat, "formatId" | "ext" | "hasVideo" | "hasAudio">): ResolvedFormat {
  return { url: "", ...p };
}

const DEFAULT_RESPONSE: ResolveYtUrlResponse = {
  ok: true,
  result: {
    videoId: "abc123",
    title: "My Video",
    formats: [
      // Progressive 720p
      format({ formatId: "22", ext: "mp4", hasVideo: true, hasAudio: true, height: 720, quality: "720p", fileSize: 1_048_576, videoCodec: "avc1.640028", audioCodec: "mp4a.40.2" }),
      // Adaptive video-only 1080p mp4 (avc1)
      format({ formatId: "137", ext: "mp4", hasVideo: true, hasAudio: false, height: 1080, quality: "1080p", videoCodec: "avc1.640028", fileSize: 50_000_000 }),
      // Adaptive video-only 1080p webm (vp9)
      format({ formatId: "248", ext: "webm", hasVideo: true, hasAudio: false, height: 1080, quality: "1080p", videoCodec: "vp9", fileSize: 40_000_000 }),
      // Audio-only m4a 128kbps
      format({ formatId: "140", ext: "m4a", hasVideo: false, hasAudio: true, audioBitrate: 128, audioCodec: "mp4a.40.2", fileSize: 2_000_000 }),
      // Audio-only opus 160kbps
      format({ formatId: "251", ext: "webm", hasVideo: false, hasAudio: true, audioBitrate: 160, audioCodec: "opus", fileSize: 2_500_000 }),
    ],
  },
};

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
    sendMessageSpy.mockResolvedValue({ ok: true, result: { videoId: "x", title: "t", formats: [] } } as ResolveYtUrlResponse);
    const d = new YouTubeDetector();
    d.start();
    await flush();
    expect(sendMessageSpy).toHaveBeenCalledWith({
      type: "RESOLVE_YT_URL",
      pageUrl: window.location.href,
    });
    d.stop();
  });

  it("renders three groups: Combined, Video (mux), Audio", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue(DEFAULT_RESPONSE);
    const d = new YouTubeDetector();
    d.start();
    await flush();
    await flush();

    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const headers = Array.from(document.querySelectorAll("[data-warpdl-overlay-group]")).map((h) => h.textContent);
    expect(headers).toContain("Combined");
    expect(headers).toContain("Video (mux)");
    expect(headers).toContain("Audio");
    d.stop();
  });

  it("pairs video-only mp4 with mp4-family audio (m4a)", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue(DEFAULT_RESPONSE);
    const d = new YouTubeDetector();
    d.start();
    await flush();
    await flush();

    // Click the 1080p mp4 (HD) item, capture its emitted message.
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const items = Array.from(document.querySelectorAll("[data-warpdl-overlay-item]")) as HTMLElement[];
    const mp4HD = items.find((el) => el.textContent?.includes("1080p") && el.textContent?.includes("mp4"));
    expect(mp4HD).toBeDefined();
    mp4HD!.click();

    expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "DOWNLOAD_YT_VIDEO",
      videoId: "abc123",
      videoFormatId: "137",
      audioFormatId: "140", // mp4-family pair
    }));
    d.stop();
  });

  it("pairs video-only webm with webm-family audio (opus)", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue(DEFAULT_RESPONSE);
    const d = new YouTubeDetector();
    d.start();
    await flush();
    await flush();

    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const items = Array.from(document.querySelectorAll("[data-warpdl-overlay-item]")) as HTMLElement[];
    const webmHD = items.find((el) => el.textContent?.includes("1080p") && el.textContent?.includes("webm"));
    expect(webmHD).toBeDefined();
    webmHD!.click();

    expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "DOWNLOAD_YT_VIDEO",
      videoFormatId: "248",
      audioFormatId: "251", // opus/webm pair
    }));
    d.stop();
  });

  it("progressive click sends DOWNLOAD_YT_VIDEO with no audioFormatId", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue(DEFAULT_RESPONSE);
    const d = new YouTubeDetector();
    d.start();
    await flush();
    await flush();

    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const items = Array.from(document.querySelectorAll("[data-warpdl-overlay-item]")) as HTMLElement[];
    const itag22 = items.find((el) => el.textContent?.includes("720p"));
    expect(itag22).toBeDefined();
    itag22!.click();

    const call = sendMessageSpy.mock.calls.find(([msg]) => (msg as any).type === "DOWNLOAD_YT_VIDEO");
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      type: "DOWNLOAD_YT_VIDEO",
      videoId: "abc123",
      videoFormatId: "22",
    });
    expect((call![0] as any).audioFormatId).toBeUndefined();
    d.stop();
  });

  it("audio-only click sends DOWNLOAD_YT_VIDEO with no audioFormatId", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue(DEFAULT_RESPONSE);
    const d = new YouTubeDetector();
    d.start();
    await flush();
    await flush();

    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const items = Array.from(document.querySelectorAll("[data-warpdl-overlay-item]")) as HTMLElement[];
    const audio = items.find((el) => el.textContent?.includes("160 kbps"));
    expect(audio).toBeDefined();
    audio!.click();

    const call = sendMessageSpy.mock.calls.find(([msg]) => (msg as any).type === "DOWNLOAD_YT_VIDEO");
    expect(call).toBeDefined();
    expect(call![0]).toMatchObject({
      type: "DOWNLOAD_YT_VIDEO",
      videoFormatId: "251",
    });
    expect((call![0] as any).audioFormatId).toBeUndefined();
    d.stop();
  });

  it("renders no options when resolve.url returns no videoId", async () => {
    makeYouTubePlayer();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendMessageSpy.mockResolvedValue({
      ok: true,
      result: { title: "no id", formats: DEFAULT_RESPONSE.ok ? DEFAULT_RESPONSE.result.formats : [] },
    } as ResolveYtUrlResponse);

    const d = new YouTubeDetector();
    d.start();
    await flush();

    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    expect(document.querySelectorAll("[data-warpdl-overlay-item]").length).toBe(0);
    const calls = warnSpy.mock.calls.map((c) => c.join(" "));
    expect(calls.some((c) => c.includes("[WarpDL YT]") && c.includes("videoId"))).toBe(true);
    warnSpy.mockRestore();
    d.stop();
  });

  it("renders no options on resolve failure", async () => {
    makeYouTubePlayer();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendMessageSpy.mockResolvedValue({ ok: false, error: "kkdai parse failed", code: -32101 } as ResolveYtUrlResponse);

    const d = new YouTubeDetector();
    d.start();
    await flush();

    expect(warnSpy).toHaveBeenCalled();
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    expect(document.querySelectorAll("[data-warpdl-overlay-item]").length).toBe(0);
    warnSpy.mockRestore();
    d.stop();
  });

  it("stop removes overlay", () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue({ ok: true, result: { videoId: "x", title: "t", formats: [] } } as ResolveYtUrlResponse);
    const d = new YouTubeDetector();
    d.start();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).not.toBeNull();
    d.stop();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).toBeNull();
  });

  it("does not re-resolve when URL is unchanged", async () => {
    makeYouTubePlayer();
    sendMessageSpy.mockResolvedValue({ ok: true, result: { videoId: "x", title: "t", formats: [] } } as ResolveYtUrlResponse);
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
    sendMessageSpy.mockResolvedValue({ ok: true, result: { videoId: "x", title: "t", formats: [] } } as ResolveYtUrlResponse);
    const d = new YouTubeDetector();
    d.start();
    await flush();

    window.history.replaceState(null, "", "/watch?v=new");
    document.dispatchEvent(new Event("yt-navigate-finish"));
    await new Promise((r) => setTimeout(r, 600));

    expect(sendMessageSpy).toHaveBeenCalled();
    const pageUrls = sendMessageSpy.mock.calls
      .filter(([msg]) => (msg as any).type === "RESOLVE_YT_URL")
      .map(([msg]) => (msg as { pageUrl: string }).pageUrl);
    expect(pageUrls.some((u) => u.endsWith("/watch?v=new"))).toBe(true);
    d.stop();
  });
});
