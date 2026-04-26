// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountOverlay } from "../../../src/detect/overlay";
import type { OverlayOption } from "../../../src/types";

function mkVideo(width = 640, height = 360): HTMLVideoElement {
  const parent = document.createElement("div");
  parent.style.position = "relative";
  const video = document.createElement("video");
  Object.defineProperty(video, "getBoundingClientRect", {
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }),
  });
  parent.appendChild(video);
  document.body.appendChild(parent);
  return video;
}

// jsdom doesn't implement ResizeObserver — polyfill a noop.
beforeEach(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mountOverlay", () => {
  it("mounts a button near the video", () => {
    const video = mkVideo();
    mountOverlay({ video, options: [], onSelect: vi.fn() });
    const btn = document.querySelector("[data-warpdl-overlay-btn]");
    expect(btn).not.toBeNull();
  });

  it("shows 'Detecting…' when options is empty", () => {
    const video = mkVideo();
    mountOverlay({ video, options: [], onSelect: vi.fn() });
    const btn = document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement;
    expect(btn.textContent).toContain("Detecting");
  });

  it("shows normal label when options are provided", () => {
    const video = mkVideo();
    const options: OverlayOption[] = [{ label: "720p", url: "https://x/a" }];
    mountOverlay({ video, options, onSelect: vi.fn() });
    const btn = document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement;
    expect(btn.textContent).toContain("WarpDL");
  });

  it("setOptions replaces list without remount", () => {
    const video = mkVideo();
    const handle = mountOverlay({ video, options: [], onSelect: vi.fn() });
    handle.setOptions([{ label: "720p", url: "https://x/a" }]);
    // Open dropdown to verify
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const items = document.querySelectorAll("[data-warpdl-overlay-item]");
    expect(items.length).toBe(1);
    expect((items[0] as HTMLElement).textContent).toContain("720p");
  });

  it("clicking button toggles dropdown", () => {
    const video = mkVideo();
    mountOverlay({ video, options: [{ label: "720p", url: "u" }], onSelect: vi.fn() });
    const btn = document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement;
    expect(document.querySelector("[data-warpdl-overlay-dropdown]")).toBeNull();
    btn.click();
    expect(document.querySelector("[data-warpdl-overlay-dropdown]")).not.toBeNull();
    btn.click();
    expect(document.querySelector("[data-warpdl-overlay-dropdown]")).toBeNull();
  });

  it("clicking outside closes dropdown", () => {
    const video = mkVideo();
    mountOverlay({ video, options: [{ label: "720p", url: "u" }], onSelect: vi.fn() });
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    expect(document.querySelector("[data-warpdl-overlay-dropdown]")).not.toBeNull();
    document.body.click();
    expect(document.querySelector("[data-warpdl-overlay-dropdown]")).toBeNull();
  });

  it("clicking option invokes onSelect and closes dropdown", () => {
    const video = mkVideo();
    const onSelect = vi.fn();
    const options: OverlayOption[] = [{ label: "720p", url: "https://x/a" }];
    mountOverlay({ video, options, onSelect });
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    (document.querySelector("[data-warpdl-overlay-item]") as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith(options[0]);
    expect(document.querySelector("[data-warpdl-overlay-dropdown]")).toBeNull();
  });

  it("groups options with group headers", () => {
    const video = mkVideo();
    mountOverlay({
      video,
      options: [
        { label: "720p", url: "u1", group: "Combined" },
        { label: "1080p", url: "u2", group: "Video only" },
      ],
      onSelect: vi.fn(),
    });
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const headers = document.querySelectorAll("[data-warpdl-overlay-group]");
    expect(headers.length).toBe(2);
    expect(headers[0].textContent).toContain("Combined");
    expect(headers[1].textContent).toContain("Video only");
  });

  it("renders sublabel below main label", () => {
    const video = mkVideo();
    mountOverlay({
      video,
      options: [{ label: "1080p", sublabel: "video only", url: "u" }],
      onSelect: vi.fn(),
    });
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const item = document.querySelector("[data-warpdl-overlay-item]") as HTMLElement;
    expect(item.textContent).toContain("1080p");
    expect(item.textContent).toContain("video only");
  });

  it("destroy removes DOM and listeners", () => {
    const video = mkVideo();
    const handle = mountOverlay({ video, options: [{ label: "720p", url: "u" }], onSelect: vi.fn() });
    expect(document.querySelector("[data-warpdl-overlay-btn]")).not.toBeNull();
    handle.destroy();
    expect(document.querySelector("[data-warpdl-overlay-btn]")).toBeNull();
    // Click the document after destroy — should not throw
    expect(() => document.body.click()).not.toThrow();
  });

  it("setOptions called twice keeps dropdown content consistent", () => {
    const video = mkVideo();
    const handle = mountOverlay({ video, options: [{ label: "A", url: "a" }], onSelect: vi.fn() });
    handle.setOptions([{ label: "B", url: "b" }, { label: "C", url: "c" }]);
    (document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement).click();
    const items = Array.from(document.querySelectorAll("[data-warpdl-overlay-item]")).map((n) => n.textContent);
    expect(items.some((t) => t?.includes("B"))).toBe(true);
    expect(items.some((t) => t?.includes("C"))).toBe(true);
    expect(items.some((t) => t?.includes("A"))).toBe(false);
  });

  it("sets position relative on parent when parent is static", () => {
    const parent = document.createElement("div");
    parent.style.position = "";  // static
    const video = document.createElement("video");
    parent.appendChild(video);
    document.body.appendChild(parent);
    mountOverlay({ video, options: [], onSelect: vi.fn() });
    expect(parent.style.position).toBe("relative");
  });

  it("leaves parent position alone when already positioned", () => {
    const parent = document.createElement("div");
    parent.style.position = "absolute";
    const video = document.createElement("video");
    parent.appendChild(video);
    document.body.appendChild(parent);
    mountOverlay({ video, options: [], onSelect: vi.fn() });
    expect(parent.style.position).toBe("absolute");
  });

  it("noops gracefully when video has no parent", () => {
    const video = document.createElement("video");
    expect(() => mountOverlay({ video, options: [], onSelect: vi.fn() })).not.toThrow();
  });

  it("uses compact label for small videos (<200px wide or <100px tall)", () => {
    const video = mkVideo(100, 50);   // below threshold
    mountOverlay({ video, options: [{ label: "720p", url: "u" }], onSelect: vi.fn() });
    const btn = document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement;
    expect(btn.textContent).toBe("⬇");
  });

  it("uses full label for large videos", () => {
    const video = mkVideo(800, 450);
    mountOverlay({ video, options: [{ label: "720p", url: "u" }], onSelect: vi.fn() });
    const btn = document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement;
    expect(btn.textContent).toContain("WarpDL");
  });

  it("re-parents overlay into fullscreen element on fullscreenchange", () => {
    const video = mkVideo(800, 450);
    mountOverlay({ video, options: [], onSelect: vi.fn() });
    const btn = document.querySelector("[data-warpdl-overlay-btn]") as HTMLElement;
    const parent = video.parentElement!;
    expect(btn.parentElement).toBe(parent);

    const fs = document.createElement("div");
    document.body.appendChild(fs);
    Object.defineProperty(document, "fullscreenElement", { value: fs, configurable: true });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(btn.parentElement).toBe(fs);

    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(btn.parentElement).toBe(parent);
  });

  it("leaves computed-fixed parent position alone (does not overwrite with relative)", () => {
    const parent = document.createElement("div");
    const video = document.createElement("video");
    parent.appendChild(video);
    document.body.appendChild(parent);
    // Mock computed style to return "fixed"
    const origGetComputedStyle = window.getComputedStyle;
    (window.getComputedStyle as any) = () => ({ position: "fixed" });
    mountOverlay({ video, options: [], onSelect: vi.fn() });
    (window.getComputedStyle as any) = origGetComputedStyle;
    expect(parent.style.position).toBe("");  // not overwritten
  });

  it("destroys ResizeObserver and fullscreenchange listener on destroy()", () => {
    const video = mkVideo();
    const handle = mountOverlay({ video, options: [], onSelect: vi.fn() });
    const removeSpy = vi.spyOn(document, "removeEventListener");
    handle.destroy();
    expect(removeSpy).toHaveBeenCalledWith("fullscreenchange", expect.any(Function));
    removeSpy.mockRestore();
  });
});
