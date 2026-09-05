import { afterEach, describe, expect, it } from "vitest";

import { createVehicleSearchDraft } from "@dealfinder/domain";

import { openDatabase, type DatabaseConnection } from "../connection.js";
import { runMigrations } from "../migration-runner.js";
import { allMigrations, LATEST_SCHEMA_VERSION } from "./index.js";
import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

interface MigrationRow {
  version: number;
  name: string;
}

describe("database migrations", () => {
  let testDatabase: TestDatabase | undefined;
  let reopenedConnection: DatabaseConnection | undefined;

  afterEach(() => {
    reopenedConnection?.close();
    testDatabase?.cleanup();
    reopenedConnection = undefined;
    testDatabase = undefined;
  });

  it("migrates a blank database to the latest schema", () => {
    testDatabase = createTestDatabase();

    expect(testDatabase.connection.migrationResult).toEqual({
      currentVersion: LATEST_SCHEMA_VERSION,
      appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    });
    const migrations = testDatabase.connection.database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as unknown as MigrationRow[];
    expect(migrations).toEqual([
      { version: 1, name: "create_settings" },
      { version: 2, name: "create_searches" },
      { version: 3, name: "create_search_sources" },
      { version: 4, name: "create_raw_candidates" },
      { version: 5, name: "create_scan_state" },
      { version: 6, name: "create_facebook_health" },
      { version: 7, name: "create_listing_lifecycle" },
      { version: 8, name: "create_normalized_vehicle_facts" },
      { version: 9, name: "create_geocoding_cache" },
      { version: 10, name: "create_enrichment_processing" },
      { version: 11, name: "create_deal_scores" },
      { version: 12, name: "create_duplicate_groups" },
      { version: 13, name: "create_listing_review_workflow" },
      { version: 14, name: "create_listing_classifications" },
      { version: 15, name: "allow_cancelled_processing_queue" },
      { version: 16, name: "capture_listing_descriptions" },
      { version: 17, name: "listing_detail_descriptions" },
      { version: 18, name: "listing_detail_facts" },
      { version: 19, name: "listing_detail_capture_attempts" }
    ]);
  });

  it("does not reapply migrations after restart", () => {
    testDatabase = createTestDatabase();
    testDatabase.connection.close();

    reopenedConnection = openDatabase({ filename: testDatabase.filename });

    expect(reopenedConnection.migrationResult).toEqual({
      currentVersion: LATEST_SCHEMA_VERSION,
      appliedVersions: []
    });
  });

  it("enables foreign keys and keeps sensitive data out of the schema", () => {
    testDatabase = createTestDatabase();
    const database = testDatabase.connection.database;

    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1
    });

    const schema = database
      .prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name")
      .all()
      .map((row) => String((row as { sql: string }).sql))
      .join("\n")
      .toLowerCase();

    expect(schema).not.toMatch(/bot_token|api_key|password|browser_cookie|facebook_session/u);
    expect(schema).not.toMatch(/seller_name|seller_profile|seller_contact|phone_number|email_address/u);
    expect(schema).not.toMatch(/request_body|request_payload|response_body|system_prompt|api_secret/u);
  });

  it("backfills Phase 3 candidates as a non-alertable initial backlog", () => {
    const database = openDatabase({
      filename: ":memory:",
      migrations: allMigrations.slice(0, 6)
    });
    const draft = createVehicleSearchDraft("Existing Golf search");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    insertLegacyRawObservation(database.database, search.id, {
      sourceListingId: "100000000000001",
      observedAt: "2026-08-22T09:00:00.000Z",
      title: "Volkswagen Golf",
      displayedPrice: "14 950 €",
      location: "Lisboa",
      rawCardFacts: ["Volkswagen Golf"]
    });

    const result = runMigrations(database.database, allMigrations, () => new Date("2026-08-23"));
    expect(result.appliedVersions).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const listing = database.database.prepare(`
      SELECT id, discovery_kind FROM listings WHERE source_listing_id = ?
    `).get("100000000000001") as unknown as { id: number; discovery_kind: string };
    expect(listing.discovery_kind).toBe("initial_backlog");
    expect(database.database.prepare(`
      SELECT type, alertable FROM listing_events WHERE listing_id = ?
    `).all(listing.id)).toEqual([{ type: "new_listing", alertable: 0 }]);
    database.close();
  });

  it("preserves existing queue rows when enabling classifier cancellation", () => {
    const database = openDatabase({
      filename: ":memory:",
      migrations: allMigrations.slice(0, 14)
    });
    const draft = createVehicleSearchDraft("Existing queue listing");
    draft.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
    const search = database.searches.create(draft);
    const raw = insertLegacyRawObservation(database.database, search.id, {
      sourceListingId: "100000000000007",
      observedAt: "2026-08-23T09:00:00.000Z",
      title: "BMW 320d 2020",
      displayedPrice: "24 900 €",
      location: "Lisboa",
      rawCardFacts: []
    });
    const listing = database.listings.ingestObservation({
      rawCandidateId: raw.candidate.id,
      searchId: search.id,
      observedAt: "2026-08-23T09:00:00.000Z",
      initialScan: false,
      source: "facebook",
      sourceListingId: raw.candidate.sourceListingId,
      listingUrl: raw.candidate.listingUrl,
      title: raw.observation.title,
      displayedPrice: raw.observation.displayedPrice,
      priceCents: 2_490_000
    }).listing;
    database.enrichmentProcessing.enqueue(listing.id, "2026-08-23T09:00:00.000Z");

    expect(runMigrations(database.database, allMigrations, () => new Date("2026-08-23")))
      .toEqual({ currentVersion: 19, appliedVersions: [15, 16, 17, 18, 19] });
    expect(database.enrichmentProcessing.getQueueItem(listing.id)).toMatchObject({ state: "queued" });

    database.database.prepare(`
      UPDATE processing_queue SET state = 'cancelled', last_error_code = 'excluded_by_classifier'
      WHERE listing_id = ?
    `).run(listing.id);
    expect(database.enrichmentProcessing.getQueueItem(listing.id)).toMatchObject({ state: "cancelled" });
    database.close();
  });
});

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
): {
  candidate: { id: number; sourceListingId: string; listingUrl: string };
  observation: { title: string; displayedPrice: string };
} {
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
