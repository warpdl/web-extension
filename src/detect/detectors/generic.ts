import { BaseDetector } from "../detector";
import type { OverlayOption } from "../../types";

export function getDirectSrc(video: HTMLVideoElement): string | null {
  if (video.src && !video.src.startsWith("blob:")) return video.src;
  const source = video.querySelector("source[src]") as HTMLSourceElement | null;
  if (source?.src && !source.src.startsWith("blob:")) return source.src;
  if (video.currentSrc && !video.currentSrc.startsWith("blob:")) return video.currentSrc;
  return null;
}

export class GenericDetector extends BaseDetector {
  protected shouldHandle(video: HTMLVideoElement): boolean {
    return getDirectSrc(video) !== null;
  }

  protected getOptions(video: HTMLVideoElement): OverlayOption[] {
    const url = getDirectSrc(video);
    if (!url) return [];
    return [{ label: "Download video", url }];
  }
}
