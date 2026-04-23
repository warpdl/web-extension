import { describe, it, expect, vi } from "vitest";
import { buildOptions } from "../../../../../src/detect/detectors/youtube/formats";
import type { Decoders } from "../../../../../src/detect/detectors/youtube/signature";
import type { PlayerResponse } from "../../../../../src/detect/detectors/youtube/player_data";

const passthroughDecoders: Decoders = {
  signature: (s) => s,
  nParam: (n) => n,
};

function mk(partial: Partial<PlayerResponse>): PlayerResponse {
  return {
    videoDetails: { videoId: "abc", title: "Test Video", lengthSeconds: "60", author: "Me" },
    ...partial,
  };
}

describe("buildOptions", () => {
  it("returns empty array when streamingData missing", () => {
    expect(buildOptions(mk({}), passthroughDecoders)).toEqual([]);
  });

  it("generates combined option from formats array", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/v.mp4", mimeType: "video/mp4; codecs=avc1", qualityLabel: "720p", contentLength: "1048576" },
        ],
      },
    });
    const opts = buildOptions(pr, passthroughDecoders);
    expect(opts).toHaveLength(1);
    expect(opts[0].group).toBe("Combined");
    expect(opts[0].label).toContain("720p");
    expect(opts[0].label).toContain("mp4");
    expect(opts[0].label).toContain("1.0 MB");
    expect(opts[0].url).toBe("https://a/v.mp4");
  });

  it("splits adaptive formats into video-only and audio-only groups", () => {
    const pr = mk({
      streamingData: {
        adaptiveFormats: [
          { url: "https://a/1080.webm", mimeType: "video/webm; codecs=vp9", qualityLabel: "1080p", height: 1080 },
          { url: "https://a/audio.m4a", mimeType: "audio/mp4; codecs=mp4a", audioQuality: "AUDIO_QUALITY_MEDIUM" },
        ],
      },
    });
    const opts = buildOptions(pr, passthroughDecoders);
    const groups = Array.from(new Set(opts.map((o) => o.group)));
    expect(groups).toContain("Video only");
    expect(groups).toContain("Audio only");
  });

  it("sorts combined by qualityLabel descending", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/360.mp4", mimeType: "video/mp4", qualityLabel: "360p" },
          { url: "https://a/720.mp4", mimeType: "video/mp4", qualityLabel: "720p" },
        ],
      },
    });
    const opts = buildOptions(pr, passthroughDecoders).filter((o) => o.group === "Combined");
    expect(opts[0].label).toContain("720p");
    expect(opts[1].label).toContain("360p");
  });

  it("sorts video-only by height descending", () => {
    const pr = mk({
      streamingData: {
        adaptiveFormats: [
          { url: "https://a/480.webm", mimeType: "video/webm", height: 480, qualityLabel: "480p" },
          { url: "https://a/1080.webm", mimeType: "video/webm", height: 1080, qualityLabel: "1080p" },
        ],
      },
    });
    const opts = buildOptions(pr, passthroughDecoders).filter((o) => o.group === "Video only");
    expect(opts[0].label).toContain("1080p");
    expect(opts[1].label).toContain("480p");
  });

  it("elides size when contentLength missing", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/x.mp4", mimeType: "video/mp4", qualityLabel: "720p" },
        ],
      },
    });
    const opts = buildOptions(pr, passthroughDecoders);
    expect(opts[0].label).not.toContain("MB");
    expect(opts[0].label).not.toContain("KB");
  });

  it("sets filename from video title + extension from mimeType", () => {
    const pr = mk({
      videoDetails: { videoId: "abc", title: "My Test Video", lengthSeconds: "60", author: "Me" },
      streamingData: {
        formats: [{ url: "https://a/x.mp4", mimeType: "video/mp4", qualityLabel: "720p" }],
      },
    });
    const opts = buildOptions(pr, passthroughDecoders);
    expect(opts[0].fileName).toContain("My Test Video");
    expect(opts[0].fileName).toMatch(/\.mp4$/);
  });

  it("skips formats that cannot be decoded", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { mimeType: "video/mp4", qualityLabel: "720p" },  // no url, no signatureCipher
        ],
      },
    });
    expect(buildOptions(pr, passthroughDecoders)).toEqual([]);
  });

  it("handles empty formats gracefully", () => {
    const pr = mk({ streamingData: { formats: [], adaptiveFormats: [] } });
    expect(buildOptions(pr, passthroughDecoders)).toEqual([]);
  });

  it("labels audio-only with audioQuality", () => {
    const pr = mk({
      streamingData: {
        adaptiveFormats: [
          { url: "https://a/audio.m4a", mimeType: "audio/mp4", audioQuality: "AUDIO_QUALITY_HIGH" },
        ],
      },
    });
    const opts = buildOptions(pr, passthroughDecoders);
    expect(opts[0].label).toContain("AUDIO_QUALITY_HIGH");
  });
});
