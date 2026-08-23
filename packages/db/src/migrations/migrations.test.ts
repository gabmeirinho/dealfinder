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
      appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
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
      { version: 11, name: "create_deal_scores" }
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
    database.rawCandidates.saveObservation({
      searchId: search.id,
      observedAt: "2026-08-22T09:00:00.000Z",
      candidate: {
        source: "facebook",
        sourceListingId: "100000000000001",
        url: "https://www.facebook.com/marketplace/item/100000000000001/",
        title: "Volkswagen Golf",
        displayedPrice: "14 950 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: ["Volkswagen Golf"]
      }
    });

    const result = runMigrations(database.database, allMigrations, () => new Date("2026-08-23"));
    expect(result.appliedVersions).toEqual([7, 8, 9, 10, 11]);
    const listing = database.database.prepare(`
      SELECT id, discovery_kind FROM listings WHERE source_listing_id = ?
    `).get("100000000000001") as unknown as { id: number; discovery_kind: string };
    expect(listing.discovery_kind).toBe("initial_backlog");
    expect(database.database.prepare(`
      SELECT type, alertable FROM listing_events WHERE listing_id = ?
    `).all(listing.id)).toEqual([{ type: "new_listing", alertable: 0 }]);
    database.close();
  });
});
