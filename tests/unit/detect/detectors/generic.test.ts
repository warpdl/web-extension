// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { GenericDetector, getDirectSrc } from "../../../../src/detect/detectors/generic";

describe("getDirectSrc", () => {
  it("returns video.src when set to http URL", () => {
    const v = document.createElement("video");
    v.src = "https://a.com/x.mp4";
    expect(getDirectSrc(v)).toBe("https://a.com/x.mp4");
  });

  it("returns null for blob: src", () => {
    const v = document.createElement("video");
    Object.defineProperty(v, "src", { value: "blob:https://a.com/xxx" });
    expect(getDirectSrc(v)).toBeNull();
  });

  it("falls back to <source src> child", () => {
    const v = document.createElement("video");
    const s = document.createElement("source");
    s.src = "https://a.com/x.webm";
    v.appendChild(s);
    expect(getDirectSrc(v)).toBe("https://a.com/x.webm");
  });

  it("skips <source src> when blob:", () => {
    const v = document.createElement("video");
    const s = document.createElement("source");
    Object.defineProperty(s, "src", { value: "blob:https://a.com/xxx" });
    v.appendChild(s);
    expect(getDirectSrc(v)).toBeNull();
  });

  it("uses currentSrc when nothing else", () => {
    const v = document.createElement("video");
    Object.defineProperty(v, "currentSrc", { value: "https://a.com/cs.mp4" });
    expect(getDirectSrc(v)).toBe("https://a.com/cs.mp4");
  });

  it("skips blob currentSrc", () => {
    const v = document.createElement("video");
    Object.defineProperty(v, "currentSrc", { value: "blob:https://a.com/x" });
    expect(getDirectSrc(v)).toBeNull();
  });

  it("returns null for video with no src at all", () => {
    const v = document.createElement("video");
    expect(getDirectSrc(v)).toBeNull();
  });

  it("prefers video.src over <source>", () => {
    const v = document.createElement("video");
    v.src = "https://a.com/vid.mp4";
    const s = document.createElement("source");
    s.src = "https://a.com/src.mp4";
    v.appendChild(s);
    expect(getDirectSrc(v)).toBe("https://a.com/vid.mp4");
  });
});

describe("GenericDetector", () => {
  it("shouldHandle returns true for video with direct src", () => {
    const v = document.createElement("video");
    v.src = "https://a/x.mp4";
    const d = new GenericDetector();
    expect((d as any).shouldHandle(v)).toBe(true);
  });

  it("shouldHandle returns false for video with only blob src", () => {
    const v = document.createElement("video");
    Object.defineProperty(v, "src", { value: "blob:https://a/x" });
    const d = new GenericDetector();
    expect((d as any).shouldHandle(v)).toBe(false);
  });

  it("getOptions returns a single Download option with the URL", () => {
    const v = document.createElement("video");
    v.src = "https://a/x.mp4";
    const d = new GenericDetector();
    const opts = (d as any).getOptions(v);
    expect(opts).toEqual([{ label: "Download video", url: "https://a/x.mp4" }]);
  });
});
