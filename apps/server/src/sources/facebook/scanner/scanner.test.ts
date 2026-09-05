import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import { fingerprintSearchCriteria } from "../../../modules/search-verification/fingerprint.js";
import type { FacebookScanBrowser } from "./scanner.js";
import { FacebookScanner } from "./scanner.js";

describe("Facebook scanner", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("waits through a blank at-end shell and collects cards when they render", async () => {
    const setup = createSetup();
    database = setup.database;
    const browser = new FakeScanBrowser([
      { cards: [], atEnd: true, page: marketplacePage("") },
      { cards: [card(1)], atEnd: true, page: marketplacePage("Marketplace results") }
    ]);
    const scanner = new FacebookScanner({ database: () => setup.database, browser: () => browser });
    await expect(scanner.scan(setup.searchId)).resolves.toMatchObject({ cardsSeen: 1, stopReason: "results_end" });
    expect(browser.scrolls).toBe(1);
  });

  it("pauses only the affected search when a blank shell never renders", async () => {
    const setup = createSetup();
    database = setup.database;
    const browser = new FakeScanBrowser([{ cards: [], atEnd: true, page: marketplacePage("") }]);
    const failures: Array<{ kind: string; scope: string }> = [];
    const scanner = new FacebookScanner({
      database: () => setup.database, browser: () => browser,
      failures: { pause: async (_id, failure) => { failures.push(failure); return { id: "partial" }; } }
    });
    await expect(scanner.scan(setup.searchId)).rejects.toMatchObject({ code: "FACEBOOK_PARTIAL_LOAD" });
    expect(failures).toMatchObject([{ kind: "partial_load", scope: "search" }]);
    expect(browser.scrolls).toBe(1);
    expect(setup.database.scanRuns.hasSucceeded(setup.searchId)).toBe(false);
  });

  it("caps an initial scan at 300 cards", async () => {
    const setup = createSetup();
    database = setup.database;
    const browser = new FakeScanBrowser([{
      cards: Array.from({ length: 305 }, (_, index) => card(index + 1)),
      atEnd: false
    }]);
    const scanner = new FacebookScanner({
      database: () => setup.database,
      browser: () => browser,
      now: () => new Date("2026-08-23T09:00:00.000Z")
    });

    await expect(scanner.scan(setup.searchId)).resolves.toEqual({
      cardsSeen: 300,
      newCandidates: 300,
      initialScan: true,
      stopReason: "initial_limit"
    });
    const first = setup.database.listings.getBySource("facebook", candidate(1).sourceListingId);
    expect(setup.database.geocoding.getDistance(first?.id as number, setup.searchId)?.distance)
      .toMatchObject({
        status: "approximate",
        method: "straight_line",
        label: "≈ 0.0 km straight-line"
      });
  });

  it("stops a monitoring scan after 50 consecutive known IDs", async () => {
    const setup = createSetup();
    database = setup.database;
    markBaselineComplete(setup.database, setup.searchId);
    for (let index = 1; index <= 60; index += 1) persistKnown(setup.database, setup.searchId, index);
    const browser = new FakeScanBrowser([{
      cards: Array.from({ length: 60 }, (_, index) => card(index + 1)),
      atEnd: false
    }]);
    const scanner = new FacebookScanner({
      database: () => setup.database,
      browser: () => browser,
      now: () => new Date("2026-08-23T10:00:00.000Z")
    });

    await expect(scanner.scan(setup.searchId)).resolves.toEqual({
      cardsSeen: 50,
      newCandidates: 0,
      initialScan: false,
      stopReason: "known_streak"
    });
  });

  it("resets the known streak after discovering a new listing", async () => {
    const setup = createSetup();
    database = setup.database;
    markBaselineComplete(setup.database, setup.searchId);
    for (let index = 1; index <= 25; index += 1) persistKnown(setup.database, setup.searchId, index);
    for (let index = 27; index <= 76; index += 1) persistKnown(setup.database, setup.searchId, index);
    const browser = new FakeScanBrowser([{
      cards: Array.from({ length: 76 }, (_, index) => card(index + 1)),
      atEnd: false
    }]);
    const scanner = new FacebookScanner({
      database: () => setup.database,
      browser: () => browser,
      now: () => new Date("2026-08-23T10:00:00.000Z")
    });

    const result = await scanner.scan(setup.searchId);
    expect(result).toMatchObject({
      cardsSeen: 76,
      newCandidates: 1,
      stopReason: "known_streak"
    });
  });

  it("commits no observations when a later page requires attention", async () => {
    const setup = createSetup();
    database = setup.database;
    const firstCandidate = candidate(1);
    const browser = new FakeScanBrowser([{
      cards: [card(1)],
      atEnd: false,
      page: marketplacePage("Marketplace results")
    }, {
      cards: [],
      atEnd: false,
      page: {
        ...marketplacePage("Log in to Facebook"),
        url: "https://www.facebook.com/login/"
      }
    }]);
    const failures: string[] = [];
    const scanner = new FacebookScanner({
      database: () => setup.database,
      browser: () => browser,
      now: () => new Date("2026-08-23T10:00:00.000Z"),
      failures: {
        pause: async (_searchId, failure) => {
          failures.push(failure.kind);
          return { id: "pause-1" };
        }
      }
    });

    await expect(scanner.scan(setup.searchId)).rejects.toMatchObject({
      code: "FACEBOOK_LOGIN_REQUIRED",
      pauseId: "pause-1"
    });
    expect(failures).toEqual(["login_required"]);
    expect(setup.database.rawCandidates.get("facebook", firstCandidate.sourceListingId))
      .toBeUndefined();
  });

  it("skips a small number of malformed cards on a substantial result page", async () => {
    const setup = createSetup();
    database = setup.database;
    const browser = new FakeScanBrowser([{
      cards: [
        ...Array.from({ length: 19 }, (_, index) => card(index + 1)),
        malformedCard(20)
      ],
      atEnd: true,
      page: marketplacePage("Marketplace results")
    }]);
    const scanner = new FacebookScanner({
      database: () => setup.database,
      browser: () => browser,
      now: () => new Date("2026-08-23T10:00:00.000Z")
    });

    await expect(scanner.scan(setup.searchId)).resolves.toMatchObject({
      cardsSeen: 19,
      newCandidates: 19,
      stopReason: "results_end"
    });
    expect(setup.database.listings.getBySource("facebook", candidate(1).sourceListingId))
      .toBeDefined();
  });

  it("runs the post-scan hook after listings are committed", async () => {
    const setup = createSetup();
    database = setup.database;
    let committedListingSeen = false;
    const scanner = new FacebookScanner({
      database: () => setup.database,
      browser: () => new FakeScanBrowser([{
        cards: [card(1)],
        atEnd: true,
        page: marketplacePage("Marketplace results")
      }]),
      now: () => new Date("2026-08-23T10:00:00.000Z"),
      afterScan: async (searchId) => {
        committedListingSeen = setup.database.listings.getBySource(
          "facebook",
          candidate(1).sourceListingId
        ) !== undefined && setup.database.searches.get(searchId) !== undefined;
      }
    });

    await scanner.scan(setup.searchId);
    expect(committedListingSeen).toBe(true);
  });

  it("still fails closed when too much of the result page is malformed", async () => {
    const setup = createSetup();
    database = setup.database;
    const browser = new FakeScanBrowser([{
      cards: [
        ...Array.from({ length: 8 }, (_, index) => card(index + 1)),
        malformedCard(9),
        malformedCard(10)
      ],
      atEnd: true,
      page: marketplacePage("Marketplace results")
    }]);
    const failures: string[] = [];
    const scanner = new FacebookScanner({
      database: () => setup.database,
      browser: () => browser,
      now: () => new Date("2026-08-23T10:00:00.000Z"),
      failures: {
        pause: async (_searchId, failure) => {
          failures.push(failure.kind);
          return { id: "pause-selector" };
        }
      }
    });

    await expect(scanner.scan(setup.searchId)).rejects.toMatchObject({
      code: "FACEBOOK_SELECTOR_CONTRACT",
      pauseId: "pause-selector"
    });
    expect(failures).toEqual(["selector_contract"]);
    expect(setup.database.rawCandidates.get("facebook", candidate(1).sourceListingId))
      .toBeUndefined();
  });
});

class FakeScanBrowser implements FacebookScanBrowser {
  public scrolls = 0;
  #index = 0;

  public constructor(private readonly snapshots: Array<{
    cards: string[];
    atEnd: boolean;
    page?: {
      url: string;
      title: string;
      bodyText: string;
      html: string;
      loading: boolean;
    };
  }>) {}

  public async navigate(): Promise<string> {
    return "https://www.facebook.com/marketplace/category/vehicles/";
  }

  public async snapshotMarketplaceResults() {
    return this.snapshots[Math.min(this.#index, this.snapshots.length - 1)] ?? {
      cards: [],
      atEnd: true
    };
  }

  public async scrollMarketplaceResults(): Promise<void> {
    this.scrolls += 1;
    this.#index += 1;
  }
}

function createSetup() {
  const database = openDatabase({ filename: ":memory:" });
  const draft = createVehicleSearchDraft("Golf");
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  const search = database.searches.create(draft);
  database.searchSources.saveVerification({
    searchId: search.id,
    source: "facebook",
    sourceUrl: "https://www.facebook.com/marketplace/category/vehicles/?query=Golf",
    criteriaFingerprint: fingerprintSearchCriteria(search),
    verifiedAt: "2026-08-23T08:00:00.000Z"
  });
  return { database, searchId: search.id };
}

function markBaselineComplete(database: DatabaseConnection, searchId: string): void {
  const run = database.scanRuns.enqueue(searchId, "startup", "2026-08-23T08:00:00.000Z");
  database.scanRuns.markRunning(run.id, "2026-08-23T08:00:01.000Z");
  database.scanRuns.complete({
    runId: run.id,
    completedAt: "2026-08-23T08:01:00.000Z",
    cardsSeen: 0,
    newCandidates: 0
  });
}

function persistKnown(database: DatabaseConnection, searchId: string, id: number): void {
  database.rawCandidates.saveObservation({
    searchId,
    observedAt: "2026-08-23T08:00:00.000Z",
    candidate: candidate(id)
  });
}

function candidate(id: number) {
  const sourceListingId = String(1_000_000_000_000_000 + id);
  return {
    source: "facebook" as const,
    sourceListingId,
    url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
    title: `Vehicle ${id}`,
    displayedPrice: `${10_000 + id} €`,
    location: "Lisboa",
    thumbnailUrl: null,
    rawCardFacts: [`Vehicle ${id}`]
  };
}

function card(id: number): string {
  const value = candidate(id);
  return `<a href="${value.url}"><span>${value.displayedPrice}</span><span>${value.title}</span><span>${value.location}</span></a>`;
}

function malformedCard(id: number): string {
  return `<a href="${candidate(id).url}"><img src="https://example.invalid/incomplete.jpg"></a>`;
}

function marketplacePage(bodyText: string) {
  return {
    url: "https://www.facebook.com/marketplace/category/vehicles/",
    title: "Marketplace",
    bodyText,
    html: `<main>${bodyText}</main>`,
    loading: false
  };
}
