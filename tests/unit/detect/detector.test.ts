// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BaseDetector } from "../../../src/detect/detector";
import type { OverlayOption } from "../../../src/types";

beforeEach(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as any).chrome = { runtime: { sendMessage: vi.fn() } };
});

afterEach(() => {
  document.body.innerHTML = "";
});

class TestDetector extends BaseDetector {
  shouldHandleCalls = 0;
  getOptionsCalls = 0;
  constructor(private handles_: boolean, private options_: OverlayOption[] = []) { super(); }
  protected shouldHandle(): boolean { this.shouldHandleCalls++; return this.handles_; }
  protected getOptions(): OverlayOption[] { this.getOptionsCalls++; return this.options_.slice(); }
  getHandleCount(): number { return this.handles.size; }
}

function addVideo(): HTMLVideoElement {
  const parent = document.createElement("div");
  const video = document.createElement("video");
  parent.appendChild(video);
  document.body.appendChild(parent);
  return video;
}

describe("BaseDetector", () => {
  it("scans existing videos on start", () => {
    addVideo();
    const d = new TestDetector(true, [{ label: "x", url: "u" }]);
    d.start();
    expect(d.getHandleCount()).toBe(1);
    d.stop();
  });

  it("skips videos where shouldHandle returns false", () => {
    addVideo();
    const d = new TestDetector(false);
    d.start();
    expect(d.getHandleCount()).toBe(0);
    d.stop();
  });

  it("picks up videos added to the DOM after start", async () => {
    const d = new TestDetector(true, [{ label: "x", url: "u" }]);
    d.start();
    addVideo();
    // MutationObserver fires asynchronously
    await new Promise((r) => setTimeout(r, 0));
    expect(d.getHandleCount()).toBe(1);
    d.stop();
  });

  it("unmounts overlays when videos are removed from DOM", async () => {
    const video = addVideo();
    const d = new TestDetector(true, [{ label: "x", url: "u" }]);
    d.start();
    expect(d.getHandleCount()).toBe(1);
    video.parentElement?.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(d.getHandleCount()).toBe(0);
    d.stop();
  });

  it("stop unmounts all overlays and disconnects observer", () => {
    addVideo();
    addVideo();
    const d = new TestDetector(true, [{ label: "x", url: "u" }]);
    d.start();
    expect(d.getHandleCount()).toBe(2);
    d.stop();
    expect(d.getHandleCount()).toBe(0);
  });

  it("supports async getOptions", async () => {
    class AsyncDetector extends BaseDetector {
      protected shouldHandle(): boolean { return true; }
      protected async getOptions(): Promise<OverlayOption[]> {
        return Promise.resolve([{ label: "async", url: "u" }]);
      }
      size(): number { return this.handles.size; }
    }
    addVideo();
    const d = new AsyncDetector();
    d.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(d.size()).toBe(1);
    d.stop();
  });

  it("onUserPick sends chrome.runtime.sendMessage with DOWNLOAD_VIDEO shape", () => {
    const d = new TestDetector(true, [{ label: "x", url: "u" }]);
    const video = addVideo();
    d.start();
    const opt: OverlayOption = { label: "720p", url: "https://x/a", fileName: "a.mp4" };
    (d as any).onUserPick(video, opt);
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "DOWNLOAD_VIDEO",
      url: "https://x/a",
      fileName: "a.mp4",
      pageUrl: window.location.href,
    });
    d.stop();
  });

  it("refresh updates handle options without remount", async () => {
    const options1: OverlayOption[] = [{ label: "A", url: "u1" }];
    const options2: OverlayOption[] = [{ label: "B", url: "u2" }];
    class Refreshable extends BaseDetector {
      private opts: OverlayOption[] = options1;
      protected shouldHandle(): boolean { return true; }
      protected getOptions(): OverlayOption[] { return this.opts.slice(); }
      setOpts(o: OverlayOption[]) { this.opts = o; }
      async manualRefresh(v: HTMLVideoElement) { await this.refresh(v); }
      handleFor(v: HTMLVideoElement) { return this.handles.get(v); }
    }
    const video = addVideo();
    const d = new Refreshable();
    d.start();
    const handle = d.handleFor(video);
    const spy = vi.spyOn(handle!, "setOptions");
    d.setOpts(options2);
    await d.manualRefresh(video);
    expect(spy).toHaveBeenCalledWith(options2);
    d.stop();
  });
});
