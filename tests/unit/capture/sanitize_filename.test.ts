import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../../../src/capture/sanitize_filename";

describe("sanitizeFilename", () => {
  it("passes clean names through", () => {
    expect(sanitizeFilename("hello.mp4")).toBe("hello.mp4");
  });

  it("replaces path separators", () => {
    expect(sanitizeFilename("foo/bar.mp4")).toBe("foo_bar.mp4");
    expect(sanitizeFilename("foo\\bar.mp4")).toBe("foo_bar.mp4");
  });

  it("strips control characters", () => {
    expect(sanitizeFilename("a\x00b.mp4")).toBe("a_b.mp4");
    expect(sanitizeFilename("a\x1fb.mp4")).toBe("a_b.mp4");
  });

  it("replaces reserved Windows chars", () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*.mp4')).toBe("a_b_c_d_e_f_g_.mp4");
  });

  it("caps length at 200 characters", () => {
    const long = "a".repeat(500) + ".mp4";
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".mp4")).toBe(true);
  });

  it("preserves extension when truncating long names", () => {
    const long = "a".repeat(300) + ".webm";
    const out = sanitizeFilename(long);
    expect(out.endsWith(".webm")).toBe(true);
  });

  it("handles unicode characters", () => {
    expect(sanitizeFilename("cafe\u{1F4A9}.mp4")).toBe("cafe\u{1F4A9}.mp4");
  });

  it("rejects empty input with fallback", () => {
    expect(sanitizeFilename("")).toBe("download");
  });

  it("replaces all whitespace-only input with fallback", () => {
    expect(sanitizeFilename("   ")).toBe("download");
  });

  it("strips leading/trailing dots (Windows hostile)", () => {
    expect(sanitizeFilename(".hidden.mp4.")).toBe("hidden.mp4");
  });

  it("truncates to MAX_LEN without extension preservation when name has no dot", () => {
    const long = "a".repeat(300); // no extension
    const out = sanitizeFilename(long);
    expect(out.length).toBe(200);
    expect(out).toBe("a".repeat(200));
  });

  it("truncates to MAX_LEN without extension preservation when extension is too long (>10 chars)", () => {
    // Total length = 250 + 1 + 15 = 266 > 200; extension is 15 chars > 10 so no extension preserved
    const longExt = "a".repeat(250) + "." + "b".repeat(15);
    const out = sanitizeFilename(longExt);
    expect(out.length).toBe(200);
    // No extension appended — just a plain slice of the beginning
    expect(out.endsWith("b".repeat(15))).toBe(false);
  });
});
