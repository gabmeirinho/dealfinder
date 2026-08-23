import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";

import {
  BrowserManager,
  type BrowserSession
} from "../browser/index.js";
import { ScanScheduler } from "../scheduler/index.js";
import {
  FacebookHealthCommandError,
  FacebookHealthService
} from "./service.js";

describe("Facebook health resume controls", () => {
  let database: DatabaseConnection | undefined;
  let browser: BrowserManager | undefined;

  afterEach(async () => {
    await browser?.shutdown();
    database?.close();
  });

  it("cannot clear a browser pause before the visible browser is reviewed", async () => {
    database = openDatabase({ filename: ":memory:" });
    const pause = database.facebookHealth.pause({
      scope: "browser",
      scopeKey: "facebook-browser",
      searchId: null,
      failureKind: "checkpoint",
      detail: "Facebook presented an account checkpoint",
      diagnosticId: null,
      pausedAt: "2026-08-23T09:00:00.000Z"
    });
    browser = new BrowserManager({
      adapter: { open: async () => new ReviewSession() },
      profileDirectory: "/profile"
    });
    const scheduler = new ScanScheduler({
      database: () => database as DatabaseConnection,
      scanner: { scan: async () => ({
        cardsSeen: 0,
        newCandidates: 0,
        initialScan: true,
        stopReason: "results_end"
      }) }
    });
    const service = new FacebookHealthService({
      database: () => database as DatabaseConnection,
      browser: () => browser as BrowserManager,
      scheduler: () => scheduler,
      now: () => new Date("2026-08-23T10:00:00.000Z")
    });

    await expect(service.resume(pause.id)).rejects.toMatchObject({
      code: "BROWSER_REVIEW_REQUIRED"
    } satisfies Partial<FacebookHealthCommandError>);
    expect(database.facebookHealth.listActivePauses()).toHaveLength(1);

    await browser.open();
    await expect(service.resume(pause.id)).resolves.toMatchObject({
      resolvedAt: "2026-08-23T10:00:00.000Z"
    });
    expect(database.facebookHealth.listActivePauses()).toEqual([]);
  });
});

class ReviewSession implements BrowserSession {
  public readonly controlledTabs = 1 as const;
  public async navigate(url: string): Promise<string> { return url; }
  public currentUrl(): string { return "https://www.facebook.com/marketplace/"; }
  public async close(): Promise<void> {}
  public onClosed(): () => void { return () => undefined; }
}
