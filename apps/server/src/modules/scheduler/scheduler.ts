import type { DatabaseConnection } from "@dealfinder/db";
import {
  SCAN_INTERVAL_MAX_MINUTES,
  SCAN_INTERVAL_MINUTES,
  type ScanQueueReceipt,
  type ScanRun,
  type VehicleSearch
} from "@dealfinder/domain";

import { fingerprintSearchCriteria } from "../search-verification/fingerprint.js";
import type { FacebookScanResult } from "../../sources/facebook/scanner/index.js";

const MINUTE_MS = 60_000;

export interface ScheduledScanner {
  scan(searchId: string): Promise<FacebookScanResult>;
}

export interface SchedulerClock {
  now(): Date;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ScanSchedulerOptions {
  database: () => DatabaseConnection;
  scanner: ScheduledScanner;
  clock?: SchedulerClock;
  random?: () => number;
}

export class ScanScheduler {
  readonly #database: () => DatabaseConnection;
  readonly #scanner: ScheduledScanner;
  readonly #clock: SchedulerClock;
  readonly #random: () => number;
  #running = false;
  #worker: Promise<void> | undefined;
  #timer: unknown;
  #deferredForBrowser = false;
  #wakeRequested = false;

  public constructor(options: ScanSchedulerOptions) {
    this.#database = options.database;
    this.#scanner = options.scanner;
    this.#clock = options.clock ?? systemClock;
    this.#random = options.random ?? Math.random;
  }

  public start(): void {
    if (this.#running) return;
    this.#running = true;
    const database = this.#database();
    database.scanRuns.requeueInterrupted();
    const requestedAt = this.#clock.now().toISOString();
    for (const search of this.eligibleSearches()) {
      database.scanRuns.enqueue(search.id, "startup", requestedAt);
    }
    this.kickWorker();
  }

  public async stop(): Promise<void> {
    this.#running = false;
    this.clearTimer();
    await this.#worker;
  }

  public requestScan(searchId: string): ScanQueueReceipt {
    const requestedAt = this.#clock.now().toISOString();
    const run = this.#database().scanRuns.enqueue(searchId, "manual", requestedAt);
    if (this.#running) this.kickWorker();
    return receipt(run);
  }

  /** Retries durable queued work after the visible browser becomes available. */
  public wake(): void {
    if (!this.#running) return;
    this.#wakeRequested = true;
    this.kickWorker();
  }

  public resumeAcquisition(searchId: string | null = null): void {
    if (!this.#running) return;
    const requestedAt = this.#clock.now().toISOString();
    for (const search of this.eligibleSearches()) {
      if (searchId === null || search.id === searchId) {
        this.#database().scanRuns.enqueue(search.id, "manual", requestedAt);
      }
    }
    this.wake();
  }

  /** Processes due schedules now; public to support controlled-clock tests. */
  public async runDue(): Promise<void> {
    if (!this.#running) return;
    this.clearTimer();
    const now = this.#clock.now().toISOString();
    const database = this.#database();
    for (const search of this.eligibleSearches()) {
      const schedule = database.scanRuns.getSchedule(search.id);
      if (schedule?.nextScanAt !== null && schedule?.nextScanAt !== undefined && schedule.nextScanAt <= now) {
        database.scanRuns.enqueue(search.id, "scheduled", now);
      }
    }
    this.kickWorker();
    await this.whenIdle();
  }

  public async whenIdle(): Promise<void> {
    while (this.#worker !== undefined) await this.#worker;
  }

  private kickWorker(): void {
    if (!this.#running || this.#worker !== undefined) return;
    this.#wakeRequested = false;
    this.#deferredForBrowser = false;
    this.clearTimer();
    this.#worker = this.drainQueue().finally(() => {
      this.#worker = undefined;
      if (!this.#running) return;
      if (this.#wakeRequested) {
        this.#wakeRequested = false;
        this.kickWorker();
        return;
      }
      if (this.#deferredForBrowser) return;
      if (this.hasRunnableQueued()) {
        this.kickWorker();
      } else {
        this.armTimer();
      }
    });
  }

  private async drainQueue(): Promise<void> {
    while (this.#running) {
      const queued = this.nextQueuedRun();
      if (queued === undefined) return;
      const database = this.#database();
      const search = this.eligibleSearches().find(({ id }) => id === queued.searchId);
      const completedAt = (): string => this.#clock.now().toISOString();
      if (search === undefined) {
        database.scanRuns.rejectQueued(queued.id, completedAt(), "SEARCH_NOT_SCANNABLE");
        continue;
      }

      database.scanRuns.markRunning(queued.id, completedAt());
      try {
        const result = await this.#scanner.scan(search.id);
        const finishedAt = completedAt();
        if (database.scanRuns.get(queued.id) === undefined) continue;
        database.transaction(() => {
          database.scanRuns.complete({
            runId: queued.id,
            completedAt: finishedAt,
            cardsSeen: result.cardsSeen,
            newCandidates: result.newCandidates
          });
          database.scanRuns.recordSchedule(
            search.id,
            finishedAt,
            this.nextScanAt(search, 0, finishedAt),
            0
          );
        });
      } catch (error: unknown) {
        if (database.scanRuns.get(queued.id) === undefined) continue;
        const code = scanErrorCode(error);
        if (isDeferredBrowserError(code)) {
          database.scanRuns.requeueRunning(queued.id);
          this.#deferredForBrowser = true;
          return;
        }
        const finishedAt = completedAt();
        if (database.facebookHealth.isBlocked(search.id)) {
          database.transaction(() => {
            database.scanRuns.fail({ runId: queued.id, completedAt: finishedAt, errorCode: code });
            database.scanRuns.pauseSchedule(search.id, finishedAt);
          });
          continue;
        }
        const failures = (database.scanRuns.getSchedule(search.id)?.consecutiveFailures ?? 0) + 1;
        database.transaction(() => {
          database.scanRuns.fail({ runId: queued.id, completedAt: finishedAt, errorCode: code });
          database.scanRuns.recordSchedule(
            search.id,
            finishedAt,
            this.nextScanAt(search, failures, finishedAt),
            failures
          );
        });
      }
    }
  }

  private nextQueuedRun(): ScanRun | undefined {
    const priorities = new Map(this.#database().searches.list().map((search) => [search.id, search.priority]));
    return this.#database().scanRuns.listQueued().sort((left, right) =>
      (priorities.get(left.searchId) ?? Number.MAX_SAFE_INTEGER) -
        (priorities.get(right.searchId) ?? Number.MAX_SAFE_INTEGER) ||
      left.requestedAt.localeCompare(right.requestedAt) ||
      left.id.localeCompare(right.id)
    )[0];
  }

  private eligibleSearches(): VehicleSearch[] {
    const database = this.#database();
    return database.searches.list().filter((search) => {
      if (!search.active) return false;
      if (database.facebookHealth.isBlocked(search.id)) return false;
      const source = database.searchSources.get(search.id, "facebook");
      return source !== undefined &&
        source.criteriaFingerprint === fingerprintSearchCriteria(search);
    });
  }

  private hasRunnableQueued(): boolean {
    const eligible = new Set(this.eligibleSearches().map(({ id }) => id));
    return this.#database().scanRuns.listQueued().some((run) => eligible.has(run.searchId));
  }

  private nextScanAt(search: VehicleSearch, failures: number, from: string): string {
    const random = Math.min(1, Math.max(0, this.#random()));
    const priorityDelay = Math.max(0, search.priority - 1) * 0.5;
    const randomizedMinutes = Math.min(
      SCAN_INTERVAL_MAX_MINUTES,
      SCAN_INTERVAL_MINUTES + random *
        (SCAN_INTERVAL_MAX_MINUTES - SCAN_INTERVAL_MINUTES) + priorityDelay
    );
    const backoffMultiplier = failures === 0 ? 1 : Math.min(4, 2 ** failures);
    return new Date(Date.parse(from) + randomizedMinutes * backoffMultiplier * MINUTE_MS)
      .toISOString();
  }

  private armTimer(): void {
    this.clearTimer();
    const schedules = this.eligibleSearches()
      .map((search) => this.#database().scanRuns.getSchedule(search.id)?.nextScanAt)
      .filter((value): value is string => value !== null && value !== undefined)
      .sort();
    const next = schedules[0];
    if (next === undefined) return;
    const delay = Math.max(0, Date.parse(next) - this.#clock.now().getTime());
    this.#timer = this.#clock.setTimeout(() => void this.runDue(), delay);
  }

  private clearTimer(): void {
    if (this.#timer === undefined) return;
    this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

const systemClock: SchedulerClock = {
  now: () => new Date(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

function receipt(run: ScanRun): ScanQueueReceipt {
  return {
    runId: run.id,
    searchId: run.searchId,
    status: "pending",
    requestedAt: run.requestedAt
  };
}

function scanErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 100);
  }
  return "SCAN_FAILED";
}

function isDeferredBrowserError(code: string): boolean {
  return ["BROWSER_NOT_OPEN", "BROWSER_BUSY", "BROWSER_RESUME_REQUIRED"].includes(code);
}
