import { DuplicateDetectionService } from "./service.js";

export interface DuplicateMaintenanceClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DuplicateMaintenanceWorkerOptions {
  service: DuplicateDetectionService;
  clock?: DuplicateMaintenanceClock;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export class DuplicateMaintenanceWorker {
  readonly #service: DuplicateDetectionService;
  readonly #clock: DuplicateMaintenanceClock;
  readonly #intervalMs: number;
  readonly #onError: (error: unknown) => void;
  #running = false;
  #worker: Promise<void> | undefined;
  #timer: unknown;
  #wakeRequested = false;

  public constructor(options: DuplicateMaintenanceWorkerOptions) {
    this.#service = options.service;
    this.#clock = options.clock ?? systemClock;
    this.#intervalMs = options.intervalMs ?? 24 * 60 * 60 * 1000;
    this.#onError = options.onError ?? (() => undefined);
  }

  public start(): void {
    if (this.#running) return;
    this.#running = true;
    this.kick();
  }

  public wake(): void {
    if (!this.#running) return;
    this.#wakeRequested = true;
    this.kick();
  }

  public async stop(): Promise<void> {
    this.#running = false;
    this.clearTimer();
    await this.#worker;
  }

  public async whenIdle(): Promise<void> {
    while (this.#worker !== undefined) await this.#worker;
  }

  private kick(): void {
    if (!this.#running || this.#worker !== undefined) return;
    this.clearTimer();
    this.#wakeRequested = false;
    this.#worker = this.#service.recomputeAll(new Date().toISOString())
      .then(() => undefined)
      .catch((error: unknown) => this.#onError(error))
      .finally(() => {
      this.#worker = undefined;
      if (!this.#running) return;
      if (this.#wakeRequested) this.kick();
      else this.#timer = this.#clock.setTimeout(() => this.kick(), this.#intervalMs);
      });
  }

  private clearTimer(): void {
    if (this.#timer === undefined) return;
    this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

const systemClock: DuplicateMaintenanceClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};
