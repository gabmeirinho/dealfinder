import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { allMigrations, openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import { loadServerConfig } from "../config/index.js";
import type { BrowserAdapter, BrowserSession } from "../modules/browser/index.js";
import { fingerprintSearchCriteria } from "../modules/search-verification/fingerprint.js";
import { createApplicationRuntime, type ApplicationRuntime } from "./application.js";

describe("application runtime", () => {
  let application: ApplicationRuntime | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await application?.stop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
    application = undefined;
    directory = undefined;
  });

  it("closes HTTP and SQLite during graceful shutdown", async () => {
    directory = mkdtempSync(join(tmpdir(), "dealfinder-runtime-"));
    const config = loadServerConfig({
      env: { DEALFINDER_DATA_DIR: directory }
    });
    config.server.port = 0;
    application = createApplicationRuntime({ config });
    const address = await application.start();
    const database = application.database?.database;

    expect(address.host).toBe("127.0.0.1");
    expect(application.server.listening).toBe(true);
    expect(database?.prepare("SELECT 1").get()).toEqual({ "1": 1 });

    await application.stop();

    expect(application.server.listening).toBe(false);
    expect(application.database).toBeUndefined();
    expect(() => database?.prepare("SELECT 1").get()).toThrow();
  });

  it("resumes queued startup scans when the visible browser opens", async () => {
    directory = mkdtempSync(join(tmpdir(), "dealfinder-runtime-"));
    const config = loadServerConfig({ env: { DEALFINDER_DATA_DIR: directory } });
    config.server.port = 0;
    const seed = openDatabase({ filename: config.paths.sqlitePath });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = seed.searches.create(draft);
    seed.searchSources.saveVerification({
      searchId: search.id,
      source: "facebook",
      sourceUrl: "https://www.facebook.com/marketplace/category/vehicles/?query=Golf",
      criteriaFingerprint: fingerprintSearchCriteria(search),
      verifiedAt: "2026-08-23T08:00:00.000Z"
    });
    seed.close();
    const browserAdapter: BrowserAdapter = {
      open: async () => new EmptyResultsSession()
    };
    application = createApplicationRuntime({ config, browserAdapter });

    await application.start();
    await application.browser.open();
    await application.scheduler.whenIdle();

    expect(application.database?.scanRuns.hasSucceeded(search.id)).toBe(true);
  });

  it("backfills legacy listing classifications before the runtime starts", async () => {
    directory = mkdtempSync(join(tmpdir(), "dealfinder-runtime-"));
    const config = loadServerConfig({ env: { DEALFINDER_DATA_DIR: directory } });
    config.server.port = 0;
    const seed = openDatabase({
      filename: config.paths.sqlitePath,
      migrations: allMigrations.slice(0, 13)
    });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = seed.searches.create(draft);
    const raw = insertLegacyRawObservation(seed.database, search.id, {
      sourceListingId: "100000000000005",
      observedAt: "2026-08-23T09:00:00.000Z",
      title: "Bancos Volkswagen Golf 4",
      displayedPrice: "500 €",
      location: "Lisboa",
      rawCardFacts: []
    });
    const listing = seed.listings.ingestObservation({
      rawCandidateId: raw.candidate.id,
      searchId: search.id,
      observedAt: "2026-08-23T09:00:00.000Z",
      initialScan: false,
      source: "facebook",
      sourceListingId: raw.candidate.sourceListingId,
      listingUrl: raw.candidate.listingUrl,
      title: raw.observation.title,
      displayedPrice: raw.observation.displayedPrice,
      priceCents: 50_000
    }).listing;
    seed.close();

    application = createApplicationRuntime({ config });
    await application.start();

    expect(application.database?.listingClassifications.get(listing.id)).toMatchObject({
      version: 2,
      subject: "part_or_accessory",
      decision: "exclude"
    });
    expect(application.database?.listingClassifications.listNeedingVersion(2)).toEqual([]);
  });
});

class EmptyResultsSession implements BrowserSession {
  public readonly controlledTabs = 1 as const;
  #url = "about:blank";

  public async navigate(url: string): Promise<string> {
    this.#url = url;
    return url;
  }

  public currentUrl(): string {
    return this.#url;
  }

  public async close(): Promise<void> {}

  public onClosed(): () => void {
    return () => undefined;
  }

  public async snapshotMarketplaceResults() {
    return { cards: [], atEnd: true };
  }

  public async scrollMarketplaceResults(): Promise<void> {}
}

function insertLegacyRawObservation(
  database: DatabaseConnection["database"],
  searchId: string,
  input: {
    sourceListingId: string;
    observedAt: string;
    title: string;
    displayedPrice: string;
    location: string;
    rawCardFacts: readonly string[];
  }
): { candidate: { id: number; sourceListingId: string; listingUrl: string }; observation: { title: string; displayedPrice: string } } {
  const listingUrl = `https://www.facebook.com/marketplace/item/${input.sourceListingId}/`;
  database.prepare(`
    INSERT INTO raw_candidates (
      source, source_listing_id, listing_url, first_seen_at, last_seen_at
    ) VALUES ('facebook', ?, ?, ?, ?)
  `).run(input.sourceListingId, listingUrl, input.observedAt, input.observedAt);
  const candidate = database.prepare(`
    SELECT id FROM raw_candidates WHERE source = 'facebook' AND source_listing_id = ?
  `).get(input.sourceListingId) as unknown as { id: number };
  database.prepare(`
    INSERT INTO raw_candidate_observations (
      candidate_id, search_id, observed_at, title, displayed_price,
      location, thumbnail_url, raw_card_facts_json
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    candidate.id,
    searchId,
    input.observedAt,
    input.title,
    input.displayedPrice,
    input.location,
    JSON.stringify(input.rawCardFacts)
  );
  return {
    candidate: { id: candidate.id, sourceListingId: input.sourceListingId, listingUrl },
    observation: { title: input.title, displayedPrice: input.displayedPrice }
  };
}
