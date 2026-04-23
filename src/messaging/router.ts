import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import type { DaemonClient } from "../daemon/client";
import type { VideoResponse } from "../downloads/video_handler";

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
  | { type: "GET_CONNECTION_STATUS" };

type AnyMessage = { type: string; [key: string]: unknown };

type Response =
  | VideoResponse
  | { connected: boolean; state: string }
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

  async handle(msg: AnyMessage): Promise<Response> {
    try {
      switch (msg.type) {
        case "DOWNLOAD_VIDEO":
          return await this.video.handle(msg as IncomingMessage & { type: "DOWNLOAD_VIDEO" });
        case "GET_CONNECTION_STATUS":
          return { connected: this.daemon.state === "OPEN", state: this.daemon.state };
        default: {
          this.log.warn("unknown_message_type", { type: msg.type });
          return { error: "unknown_type" };
        }
      }
    } catch (e) {
      this.log.error("handler_threw", { type: msg.type }, e);
      return { error: "handler_threw" };
    }
  }
}
