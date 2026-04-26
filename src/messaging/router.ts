import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import type { DaemonClient } from "../daemon/client";
import type { VideoResponse } from "../downloads/video_handler";
import type { ResolveYtUrlResponse, DownloadYtResponse } from "../types";
import { resolveUrl, youtubeDownload, DaemonRpcError } from "../daemon/rpc_client";
import { loadSettings } from "../settings";

interface VideoHandlerLike {
  handle(msg: { type: "DOWNLOAD_VIDEO"; url: string; fileName?: string; pageUrl?: string }): Promise<VideoResponse>;
}

interface Deps {
  bus: EventBus;
  log: Logger;
  daemon: DaemonClient;
  video: VideoHandlerLike;
}

export type IncomingMessage =
  | { type: "DOWNLOAD_VIDEO"; url: string; fileName?: string; pageUrl?: string }
  | { type: "DOWNLOAD_YT_VIDEO"; videoId: string; videoFormatId: string; audioFormatId?: string; fileName?: string }
  | { type: "GET_CONNECTION_STATUS" }
  | { type: "RESOLVE_YT_URL"; pageUrl: string };

type Response =
  | VideoResponse
  | { connected: boolean; state: string }
  | ResolveYtUrlResponse
  | DownloadYtResponse
  | { error: string };

export class MessageRouter {
  private log: Logger;
  private daemon: DaemonClient;
  private video: VideoHandlerLike;

  constructor(deps: Deps) {
    this.log = deps.log.child("router");
    this.daemon = deps.daemon;
    this.video = deps.video;
  }

  async handle(msg: IncomingMessage): Promise<Response> {
    try {
      switch (msg.type) {
        case "DOWNLOAD_VIDEO":
          return await this.video.handle(msg);
        case "DOWNLOAD_YT_VIDEO":
          return await this.downloadYt(msg);
        case "GET_CONNECTION_STATUS":
          return { connected: this.daemon.state === "OPEN", state: this.daemon.state };
        case "RESOLVE_YT_URL":
          return await this.resolve(msg.pageUrl);
        default: {
          const unknownMsg = msg as { type: string };
          this.log.warn("unknown_message_type", { type: unknownMsg.type });
          return { error: "unknown_type" };
        }
      }
    } catch (e) {
      this.log.error("handler_threw", { type: (msg as { type: string }).type }, e);
      return { error: "handler_threw" };
    }
  }

  private async resolve(pageUrl: string): Promise<ResolveYtUrlResponse> {
    const settings = await loadSettings();
    try {
      const result = await resolveUrl(pageUrl, {
        host: settings.daemonUrl,
        secret: settings.daemonSecret,
      });
      return { ok: true, result };
    } catch (e) {
      if (e instanceof DaemonRpcError) {
        this.log.warn("resolve_failed", { code: e.code ?? null, message: e.message });
        return { ok: false, error: e.message, code: e.code };
      }
      this.log.error("resolve_threw", {}, e);
      return { ok: false, error: (e as Error).message ?? "unknown" };
    }
  }

  private async downloadYt(msg: Extract<IncomingMessage, { type: "DOWNLOAD_YT_VIDEO" }>): Promise<DownloadYtResponse> {
    const settings = await loadSettings();
    try {
      const result = await youtubeDownload(
        {
          videoId: msg.videoId,
          videoFormatId: msg.videoFormatId,
          audioFormatId: msg.audioFormatId,
          fileName: msg.fileName,
        },
        { host: settings.daemonUrl, secret: settings.daemonSecret },
      );
      return { ok: true, result };
    } catch (e) {
      if (e instanceof DaemonRpcError) {
        this.log.warn("yt_download_failed", { code: e.code ?? null, message: e.message });
        return { ok: false, error: e.message, code: e.code };
      }
      this.log.error("yt_download_threw", {}, e);
      return { ok: false, error: (e as Error).message ?? "unknown" };
    }
  }
}
