import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "../connection.js";
import { LATEST_SCHEMA_VERSION } from "./index.js";
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
      appliedVersions: [1, 2, 3, 4, 5, 6]
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
      { version: 6, name: "create_facebook_health" }
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
  });
});
