// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pickDetector } from "../../../src/detect/content_main";

beforeEach(() => {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as any).chrome = { runtime: { sendMessage: vi.fn() } };
});

afterEach(() => {
  document.body.innerHTML = "";
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

describe("boot() via pickDetector integration", () => {
  it("detector from pickDetector can start and stop without errors", () => {
    // Exercises the boot() code path: pickDetector → detector.start() → detector.stop()
    const detector = pickDetector("example.com");
    expect(() => {
      detector.start();
      // Simulate pagehide-triggered teardown
      detector.stop();
    }).not.toThrow();
  });

  it("YouTubeDetector from pickDetector can start and stop", () => {
    const wrapper = document.createElement("div");
    wrapper.id = "movie_player";
    const video = document.createElement("video");
    wrapper.appendChild(video);
    document.body.appendChild(wrapper);
    const detector = pickDetector("www.youtube.com");
    expect(() => {
      detector.start();
      detector.stop();
    }).not.toThrow();
  });
});
