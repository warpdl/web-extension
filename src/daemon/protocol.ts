import type { CapturedDownload } from "../types";

export function encodeCapturedDownload(msg: CapturedDownload): string {
  return JSON.stringify(msg);
}

export function encodePing(): string {
  return '{"type":"ping"}';
}
