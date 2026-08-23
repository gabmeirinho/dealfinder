import type { DatabaseConnection } from "@dealfinder/db";

import { DeepSeekEnrichmentService } from "./service.js";

export interface EnrichmentWorkerClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DeepSeekEnrichmentWorkerOptions {
  database: () => DatabaseConnection;
  service: DeepSeekEnrichmentService;
  clock?: EnrichmentWorkerClock;
  pollIntervalMs?: number;
}

export class DeepSeekEnrichmentWorker {
  readonly #database: () => DatabaseConnection;
  readonly #service: DeepSeekEnrichmentService;
  readonly #clock: EnrichmentWorkerClock;
  readonly #pollIntervalMs: number;
  #running = false;
  #worker: Promise<void> | undefined;
  #timer: unknown;
  #wakeRequested = false;

  public constructor(options: DeepSeekEnrichmentWorkerOptions) {
    this.#database = options.database;
    this.#service = options.service;
    this.#clock = options.clock ?? systemClock;
    this.#pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  public start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#database().enrichmentProcessing.recoverInterrupted(new Date().toISOString());
    this.kick();
  }

  public async stop(): Promise<void> {
    this.#running = false;
    this.clearTimer();
    await this.#worker;
  }

  public wake(): void {
    if (!this.#running) return;
    this.#wakeRequested = true;
    this.kick();
  }

  public async testCreditAndResume(): Promise<boolean> {
    const succeeded = await this.#service.testCreditAndResume();
    if (succeeded) this.wake();
    return succeeded;
  }

  public async whenIdle(): Promise<void> {
    while (this.#worker !== undefined) await this.#worker;
  }

  private kick(): void {
    if (!this.#running || this.#worker !== undefined) return;
    this.clearTimer();
    this.#wakeRequested = false;
    this.#worker = this.drain().finally(() => {
      this.#worker = undefined;
      if (!this.#running) return;
      if (this.#wakeRequested) this.kick();
      else this.#timer = this.#clock.setTimeout(() => this.kick(), this.#pollIntervalMs);
    });
  }

  private async drain(): Promise<void> {
    while (this.#running) {
      const result = await this.#service.processNext();
      if (result === "succeeded" || result === "failed" || result === "retry_queued") continue;
      return;
    }
  }

  private clearTimer(): void {
    if (this.#timer === undefined) return;
    this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

const systemClock: EnrichmentWorkerClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};
