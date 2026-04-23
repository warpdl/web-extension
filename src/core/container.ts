import { EventBus } from "./events";
import { Logger } from "./logger";

export class Container {
  readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private started = false;

  bus!: EventBus;
  log!: Logger;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.bus = new EventBus();
    this.log = new Logger({ bus: this.bus });
    // Additional wiring is added in Task 21.
    this.started = true;
    this.readyResolve();
  }
}
