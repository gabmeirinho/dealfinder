import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import { fingerprintSearchCriteria } from "../search-verification/fingerprint.js";
import {
  ScanScheduler,
  type ScheduledScanner,
  type SchedulerClock
} from "./scheduler.js";

describe("scan scheduler", () => {
  let database: DatabaseConnection | undefined;
  let scheduler: ScanScheduler | undefined;

  afterEach(async () => {
    await scheduler?.stop();
    database?.close();
  });

  it("passes durable deep mode to the scanner after startup", async () => {
    database = openDatabase({ filename: ":memory:" });
    const search = createVerifiedSearch(database, "Deep", 1);
    const modes: unknown[] = [];
    database.scanRuns.enqueue(search.id, "manual", "2026-08-23T09:00:00.000Z", "deep");
    const db = database;
    scheduler = new ScanScheduler({ database: () => db, scanner: { scan: async (_id, mode) => { modes.push(mode); return scanResult(); } } });
    scheduler.start();
    await scheduler.whenIdle();
    expect(modes).toEqual(["deep"]);
  });

  it("runs one immediate catch-up sequentially in priority order", async () => {
    database = openDatabase({ filename: ":memory:" });
    const third = createVerifiedSearch(database, "Third", 3);
    const first = createVerifiedSearch(database, "First", 1);
    const second = createVerifiedSearch(database, "Second", 2);
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const scanner: ScheduledScanner = {
      scan: async (searchId) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push(searchId);
        await Promise.resolve();
        active -= 1;
        return scanResult();
      }
    };
    const clock = new ManualClock("2026-08-23T09:00:00.000Z");
    const randomValues = [0, 0.5, 1];
    scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner,
      clock,
      random: () => randomValues.shift() ?? 0
    });

    scheduler.start();
    await scheduler.whenIdle();

    expect(order).toEqual([first.id, second.id, third.id]);
    expect(maximumActive).toBe(1);
    for (const search of [first, second, third]) {
      const schedule = database.scanRuns.getSchedule(search.id);
      const delayMinutes = (
        Date.parse(schedule?.nextScanAt ?? "") - Date.parse("2026-08-23T09:00:00.000Z")
      ) / 60_000;
      expect(delayMinutes).toBeGreaterThanOrEqual(15);
      expect(delayMinutes).toBeLessThanOrEqual(30);
    }
    expect(
      (database.scanRuns.getSchedule(first.id)?.nextScanAt ?? "") <
      (database.scanRuns.getSchedule(second.id)?.nextScanAt ?? "")
    ).toBe(true);
    expect(
      (database.scanRuns.getSchedule(second.id)?.nextScanAt ?? "") <
      (database.scanRuns.getSchedule(third.id)?.nextScanAt ?? "")
    ).toBe(true);
  });

  it("serializes dashboard scan requests through the same worker", async () => {
    database = openDatabase({ filename: ":memory:" });
    const first = createVerifiedSearch(database, "First", 1);
    const second = createVerifiedSearch(database, "Second", 2);
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const scanner: ScheduledScanner = {
      scan: async (searchId) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push(searchId);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return scanResult();
      }
    };
    scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner,
      clock: new ManualClock("2026-08-23T09:00:00.000Z")
    });
    scheduler.start();
    await scheduler.whenIdle();
    order.length = 0;

    const firstReceipt = scheduler.requestScan(second.id);
    const secondReceipt = scheduler.requestScan(first.id);
    await scheduler.whenIdle();

    expect(firstReceipt.status).toBe("pending");
    expect(secondReceipt.status).toBe("pending");
    expect(order).toEqual([second.id, first.id]);
    expect(maximumActive).toBe(1);
  });

  it("runs only due work and applies bounded exponential backoff", async () => {
    database = openDatabase({ filename: ":memory:" });
    const search = createVerifiedSearch(database, "Failing", 1);
    const scanner: ScheduledScanner = {
      scan: async () => {
        throw Object.assign(new Error("temporary failure"), { code: "RATE_LIMIT" });
      }
    };
    const clock = new ManualClock("2026-08-23T09:00:00.000Z");
    scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner,
      clock,
      random: () => 0
    });

    scheduler.start();
    await scheduler.whenIdle();
    expect(database.scanRuns.getSchedule(search.id)).toMatchObject({
      consecutiveFailures: 1,
      nextScanAt: "2026-08-23T09:30:00.000Z"
    });

    clock.set("2026-08-23T09:29:59.000Z");
    await scheduler.runDue();
    expect(database.scanRuns.getSchedule(search.id)?.consecutiveFailures).toBe(1);

    clock.set("2026-08-23T09:30:00.000Z");
    await scheduler.runDue();
    expect(database.scanRuns.getSchedule(search.id)).toMatchObject({
      consecutiveFailures: 2,
      nextScanAt: "2026-08-23T10:30:00.000Z"
    });
  });

  it("keeps browser-blocked work queued and resumes it after restart", async () => {
    database = openDatabase({ filename: ":memory:" });
    const search = createVerifiedSearch(database, "Golf", 1);
    const clock = new ManualClock("2026-08-23T09:00:00.000Z");
    database.scanRuns.recordSchedule(
      search.id,
      "2026-08-23T08:30:00.000Z",
      "2026-08-23T08:45:00.000Z",
      0
    );
    scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner: {
        scan: async () => {
          throw Object.assign(new Error("open browser"), { code: "BROWSER_NOT_OPEN" });
        }
      },
      clock
    });
    scheduler.start();
    await scheduler.whenIdle();
    expect(database.scanRuns.listQueued()).toHaveLength(1);
    expect(clock.timers).toEqual([]);
    await scheduler.stop();

    let resumed = 0;
    scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner: {
        scan: async () => {
          resumed += 1;
          return scanResult();
        }
      },
      clock
    });
    scheduler.start();
    await scheduler.whenIdle();

    expect(resumed).toBe(1);
    expect(database.scanRuns.listQueued()).toEqual([]);
    expect(database.scanRuns.hasSucceeded(search.id)).toBe(true);
  });

  it("runs one catch-up instead of replaying every missed interval", async () => {
    database = openDatabase({ filename: ":memory:" });
    createVerifiedSearch(database, "Golf", 1);
    const clock = new ManualClock("2026-08-23T09:00:00.000Z");
    let scans = 0;
    scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner: {
        scan: async () => {
          scans += 1;
          return scanResult();
        }
      },
      clock,
      random: () => 0
    });
    scheduler.start();
    await scheduler.whenIdle();

    clock.set("2026-08-24T09:00:00.000Z");
    await scheduler.runDue();
    await scheduler.runDue();

    expect(scans).toBe(2);
  });

  it("honors a browser wake that arrives while deferral is settling", async () => {
    database = openDatabase({ filename: ":memory:" });
    createVerifiedSearch(database, "Golf", 1);
    let attempts = 0;
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolveStarted) => {
      releaseFirst = resolveStarted;
    });
    let signalAttempt: (() => void) | undefined;
    const attemptStarted = new Promise<void>((resolveAttempt) => {
      signalAttempt = resolveAttempt;
    });
    scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner: {
        scan: async () => {
          attempts += 1;
          if (attempts === 1) {
            signalAttempt?.();
            await firstStarted;
            throw Object.assign(new Error("browser opening"), { code: "BROWSER_NOT_OPEN" });
          }
          return scanResult();
        }
      },
      clock: new ManualClock("2026-08-23T09:00:00.000Z")
    });
    scheduler.start();
    await attemptStarted;

    scheduler.wake();
    releaseFirst?.();
    await scheduler.whenIdle();

    expect(attempts).toBe(2);
  });

  it("does not retry a classified Facebook pause until explicit resume", async () => {
    database = openDatabase({ filename: ":memory:" });
    const search = createVerifiedSearch(database, "Golf", 1);
    const clock = new ManualClock("2026-08-23T09:00:00.000Z");
    let paused = true;
    let attempts = 0;
    scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner: {
        scan: async () => {
          attempts += 1;
          if (paused) {
            database?.facebookHealth.pause({
              scope: "search",
              scopeKey: search.id,
              searchId: search.id,
              failureKind: "partial_load",
              detail: "Marketplace results did not finish loading",
              diagnosticId: null,
              pausedAt: clock.now().toISOString()
            });
            throw Object.assign(new Error("paused"), { code: "FACEBOOK_PARTIAL_LOAD" });
          }
          return scanResult();
        }
      },
      clock,
      random: () => 0
    });
    scheduler.start();
    await scheduler.whenIdle();

    expect(attempts).toBe(1);
    expect(database.scanRuns.getSchedule(search.id)?.nextScanAt).toBeNull();
    expect(clock.timers).toEqual([]);
    await scheduler.runDue();
    expect(attempts).toBe(1);

    const pause = database.facebookHealth.listActivePauses()[0];
    database.facebookHealth.resolve(pause?.id ?? "", "2026-08-23T09:05:00.000Z");
    paused = false;
    scheduler.resumeAcquisition(search.id);
    await scheduler.whenIdle();

    expect(attempts).toBe(2);
    expect(database.scanRuns.hasSucceeded(search.id)).toBe(true);
  });
});

class ManualClock implements SchedulerClock {
  #now: Date;
  public readonly timers: Array<{ callback: () => void; delayMs: number }> = [];

  public constructor(value: string) {
    this.#now = new Date(value);
  }

  public now(): Date {
    return new Date(this.#now);
  }

  public set(value: string): void {
    this.#now = new Date(value);
  }

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const timer = { callback, delayMs };
    this.timers.push(timer);
    return timer;
  }

  public clearTimeout(handle: unknown): void {
    const index = this.timers.indexOf(handle as { callback: () => void; delayMs: number });
    if (index >= 0) this.timers.splice(index, 1);
  }
}

function createVerifiedSearch(database: DatabaseConnection, name: string, priority: number) {
  const draft = createVehicleSearchDraft(name);
  draft.priority = priority;
  draft.criteria.makeKeywords = { value: [name], strength: "hard" };
  const search = database.searches.create(draft);
  database.searchSources.saveVerification({
    searchId: search.id,
    source: "facebook",
    sourceUrl: `https://www.facebook.com/marketplace/category/vehicles/?query=${name}`,
    criteriaFingerprint: fingerprintSearchCriteria(search),
    verifiedAt: "2026-08-23T08:00:00.000Z"
  });
  return search;
}

function scanResult() {
  return {
    cardsSeen: 1,
    newCandidates: 1,
    initialScan: true,
    stopReason: "results_end" as const
  };
}
