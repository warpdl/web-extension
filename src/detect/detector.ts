import type { OverlayOption } from "../types";
import { mountOverlay, OverlayHandle } from "./overlay";

export interface Detector {
  start(): void;
  stop(): void;
}

export abstract class BaseDetector implements Detector {
  protected handles = new Map<HTMLVideoElement, OverlayHandle>();
  private observer: MutationObserver | null = null;
  private stopped = false;

  start(): void {
    this.stopped = false;
    this.scan(document);
    this.observer = new MutationObserver((mutations) => this.onMutations(mutations));
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.onStart();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    for (const h of this.handles.values()) h.destroy();
    this.handles.clear();
    this.onStop();
  }

  protected abstract shouldHandle(video: HTMLVideoElement): boolean;
  protected abstract getOptions(video: HTMLVideoElement): OverlayOption[] | Promise<OverlayOption[]>;

  protected onStart(): void {}
  protected onStop(): void {}

  protected async refresh(video: HTMLVideoElement): Promise<void> {
    const h = this.handles.get(video);
    if (!h) return;
    const opts = await this.getOptions(video);
    h.setOptions(opts);
  }

  protected onUserPick(video: HTMLVideoElement, option: OverlayOption): void {
    chrome.runtime.sendMessage({
      type: "DOWNLOAD_VIDEO",
      url: option.url,
      fileName: option.fileName,
      pageUrl: window.location.href,
    });
  }

  private scan(root: ParentNode): void {
    const videos = root.querySelectorAll("video");
    for (const node of Array.from(videos)) {
      const video = node as HTMLVideoElement;
      if (this.handles.has(video)) continue;
      if (!this.shouldHandle(video)) continue;
      const result = this.getOptions(video);
      const mount = (opts: OverlayOption[]) => {
        if (this.stopped || this.handles.has(video)) return;
        const handle = mountOverlay({
          video,
          options: opts,
          onSelect: (o) => this.onUserPick(video, o),
        });
        this.handles.set(video, handle);
      };
      if (result instanceof Promise) {
        result.then(mount);
      } else {
        mount(result);
      }
    }
  }

  private onMutations(mutations: MutationRecord[]): void {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (node instanceof HTMLVideoElement) {
          this.scan(node.parentElement ?? document);
        } else if (node instanceof HTMLElement) {
          this.scan(node);
        }
      }
      for (const node of Array.from(m.removedNodes)) {
        if (node instanceof HTMLVideoElement) {
          this.handles.get(node)?.destroy();
          this.handles.delete(node);
        } else if (node instanceof HTMLElement) {
          for (const video of Array.from(node.querySelectorAll("video"))) {
            const v = video as HTMLVideoElement;
            this.handles.get(v)?.destroy();
            this.handles.delete(v);
          }
        }
      }
    }
  }
}
