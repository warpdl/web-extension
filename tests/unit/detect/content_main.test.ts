// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pickDetector } from "../../../src/detect/content_main";

beforeEach(() => {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as any).chrome = { runtime: { sendMessage: vi.fn() } };
});

describe("pickDetector", () => {
  it("returns YouTubeDetector for www.youtube.com", () => {
    const d = pickDetector("www.youtube.com");
    expect(d.constructor.name).toBe("YouTubeDetector");
  });

  it("returns YouTubeDetector for m.youtube.com", () => {
    const d = pickDetector("m.youtube.com");
    expect(d.constructor.name).toBe("YouTubeDetector");
  });

  it("returns GenericDetector for other hosts", () => {
    const d = pickDetector("example.com");
    expect(d.constructor.name).toBe("GenericDetector");
  });
});
