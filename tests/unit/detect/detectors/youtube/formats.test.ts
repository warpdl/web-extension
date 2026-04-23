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
    expect(buildOptions(mk({}), passthroughDecoders).options).toEqual([]);
  });

  it("returns zero counts when streamingData missing", () => {
    const result = buildOptions(mk({}), passthroughDecoders);
    expect(result.totalFormats).toBe(0);
    expect(result.decodedFormats).toBe(0);
  });

  it("generates combined option from formats array", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/v.mp4", mimeType: "video/mp4; codecs=avc1", qualityLabel: "720p", contentLength: "1048576" },
        ],
      },
    });
    const { options: opts } = buildOptions(pr, passthroughDecoders);
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
    const { options: opts } = buildOptions(pr, passthroughDecoders);
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
    const opts = buildOptions(pr, passthroughDecoders).options.filter((o) => o.group === "Combined");
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
    const opts = buildOptions(pr, passthroughDecoders).options.filter((o) => o.group === "Video only");
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
    const { options: opts } = buildOptions(pr, passthroughDecoders);
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
    const { options: opts } = buildOptions(pr, passthroughDecoders);
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
    expect(buildOptions(pr, passthroughDecoders).options).toEqual([]);
  });

  it("handles empty formats gracefully", () => {
    const pr = mk({ streamingData: { formats: [], adaptiveFormats: [] } });
    const result = buildOptions(pr, passthroughDecoders);
    expect(result.options).toEqual([]);
    expect(result.totalFormats).toBe(0);
    expect(result.decodedFormats).toBe(0);
  });

  it("labels audio-only with audioQuality", () => {
    const pr = mk({
      streamingData: {
        adaptiveFormats: [
          { url: "https://a/audio.m4a", mimeType: "audio/mp4", audioQuality: "AUDIO_QUALITY_HIGH" },
        ],
      },
    });
    const { options: opts } = buildOptions(pr, passthroughDecoders);
    expect(opts[0].label).toContain("AUDIO_QUALITY_HIGH");
  });

  // --- New coverage tests ---

  it("formats size in GB for very large files", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/big.mp4", mimeType: "video/mp4", qualityLabel: "2160p", contentLength: "2147483648" }, // 2 GB
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    expect(options[0].label).toContain("2.0 GB");
  });

  it("formats size in KB for sub-MB files", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/small.mp4", mimeType: "video/mp4", qualityLabel: "144p", contentLength: "524288" }, // 512 KB
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    expect(options[0].label).toContain("512 KB");
  });

  it("formats size in bytes for tiny files", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/tiny.mp4", mimeType: "video/mp4", qualityLabel: "144p", contentLength: "500" },
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    expect(options[0].label).toContain("500 B");
  });

  it("sorts audio-only by quality HIGH > MEDIUM > LOW", () => {
    const pr = mk({
      streamingData: {
        adaptiveFormats: [
          { url: "https://a/low.m4a", mimeType: "audio/mp4", audioQuality: "AUDIO_QUALITY_LOW" },
          { url: "https://a/high.m4a", mimeType: "audio/mp4", audioQuality: "AUDIO_QUALITY_HIGH" },
          { url: "https://a/med.m4a", mimeType: "audio/mp4", audioQuality: "AUDIO_QUALITY_MEDIUM" },
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    const audio = options.filter((o) => o.group === "Audio only");
    expect(audio[0].label).toContain("HIGH");
    expect(audio[1].label).toContain("MEDIUM");
    expect(audio[2].label).toContain("LOW");
  });

  it("handles audio formats without audioQuality (rank falls through to 0)", () => {
    // Exercises the return 0 fallback in byAudioQualityDesc (formats.ts line 98)
    const pr = mk({
      streamingData: {
        adaptiveFormats: [
          { url: "https://a/unknown1.m4a", mimeType: "audio/mp4" }, // no audioQuality
          { url: "https://a/unknown2.m4a", mimeType: "audio/mp4" }, // no audioQuality
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    const audio = options.filter((o) => o.group === "Audio only");
    // Both rank as 0, order is stable — just verify both are present
    expect(audio).toHaveLength(2);
  });

  it("falls back to 'bin' extension for mime types without slash", () => {
    // Exercises line 66: extFromMime when no '/' in mime — returns 'bin'
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/v.bin", mimeType: "application", qualityLabel: "720p" },
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    expect(options[0].fileName).toMatch(/\.bin$/);
  });

  it("returns empty size string for non-finite contentLength", () => {
    // Exercises line 72: !Number.isFinite(n) return "" when contentLength is not a number
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/v.mp4", mimeType: "video/mp4", qualityLabel: "720p", contentLength: "NaN" },
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    // Label should not include any size annotation
    expect(options[0].label).not.toMatch(/\d+ (KB|MB|GB|B)$/);
  });

  it("returns 0 quality for qualityLabel with no leading digits", () => {
    // Exercises line 82: parseQuality fallback when regex doesn't match
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/v.mp4", mimeType: "video/mp4", qualityLabel: "hd" }, // no leading digit
          { url: "https://a/v2.mp4", mimeType: "video/mp4", qualityLabel: "720p" },
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    // 720p should be first (higher quality), hd second (quality 0)
    expect(options[0].label).toContain("720p");
  });

  it("sorts adaptive video by height, using 0 as fallback for missing height", () => {
    // Exercises line 90: b.height ?? 0 fallback
    const pr = mk({
      streamingData: {
        adaptiveFormats: [
          { url: "https://a/low.mp4", mimeType: "video/mp4", qualityLabel: "360p" }, // no height
          { url: "https://a/high.mp4", mimeType: "video/mp4", qualityLabel: "1080p", height: 1080 },
        ],
      },
    });
    const { options } = buildOptions(pr, passthroughDecoders);
    const video = options.filter((o) => o.group === "Video only");
    expect(video[0].label).toContain("1080p");
  });

  it("returns totalFormats and decodedFormats counts", () => {
    const pr = mk({
      streamingData: {
        formats: [
          { url: "https://a/ok.mp4", mimeType: "video/mp4", qualityLabel: "720p" },
          { mimeType: "video/mp4", qualityLabel: "1080p" }, // no url, no cipher — will be dropped
        ],
      },
    });
    const result = buildOptions(pr, passthroughDecoders);
    expect(result.totalFormats).toBe(2);
    expect(result.decodedFormats).toBe(1);
  });
});
