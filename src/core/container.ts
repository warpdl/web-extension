import { EventBus } from "./events";
import { Logger } from "./logger";
import { realClock, Clock } from "./clock";
import { DaemonClient } from "../daemon/client";
import { HeaderStore } from "../capture/header_store";
import { DownloadInterceptor } from "../downloads/interceptor";
import { VideoHandler } from "../downloads/video_handler";
import { MessageRouter } from "../messaging/router";
import { loadSettings, onSettingsChanged } from "../settings";
import type { ExtensionSettings } from "../types";

export interface ContainerDeps {
  clock?: Clock;
  wsFactory?: (url: string) => WebSocket;
  writer?: (line: string) => void;
}

export class Container {
  readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private started = false;

  bus!: EventBus;
  log!: Logger;
  daemon!: DaemonClient;
  headerStore!: HeaderStore;
  interceptor!: DownloadInterceptor;
  video!: VideoHandler;
  router!: MessageRouter;

  private settings!: ExtensionSettings;
  private clock: Clock;
  private wsFactory: (url: string) => WebSocket;
  private writer?: (line: string) => void;

  constructor(deps: ContainerDeps = {}) {
    this.clock = deps.clock ?? realClock;
    this.wsFactory = deps.wsFactory ?? ((url) => new WebSocket(`ws://${url}`));
    this.writer = deps.writer;
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  currentSettings(): ExtensionSettings {
    return this.settings;
  }

  async start(): Promise<void> {
    if (this.started) return;

    this.settings = await loadSettings();
    this.bus = new EventBus();
    this.log = new Logger({ bus: this.bus, writer: this.writer });
    this.headerStore = new HeaderStore({ clock: this.clock });
    this.headerStore.startSweep();

    this.daemon = new DaemonClient({
      bus: this.bus,
      log: this.log.child("daemon"),
      clock: this.clock,
      wsFactory: this.wsFactory,
    });
    this.daemon.setUrl(this.settings.daemonUrl);
    this.daemon.start();

    this.video = new VideoHandler({ bus: this.bus, log: this.log, daemon: this.daemon });
    this.interceptor = new DownloadInterceptor({
      bus: this.bus,
      log: this.log,
      daemon: this.daemon,
      headerStore: this.headerStore,
      getSettings: () => this.settings,
    });
    this.router = new MessageRouter({ bus: this.bus, log: this.log, daemon: this.daemon, video: this.video });

    onSettingsChanged((s) => {
      this.settings = s;
      this.daemon.setUrl(s.daemonUrl);
      this.bus.emit("settings:applied", { url: s.daemonUrl, interceptEnabled: s.interceptDownloads });
    });

    this.started = true;
    this.readyResolve();
  }
}
