import type { Migration } from "./types.js";

export const createSearchSourcesMigration: Migration = {
  version: 3,
  name: "create_search_sources",
  up(database) {
    database.exec(`
      CREATE TABLE search_sources (
        search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('facebook')),
        source_url TEXT NOT NULL CHECK (length(source_url) BETWEEN 1 AND 4096),
        criteria_fingerprint TEXT NOT NULL CHECK (length(criteria_fingerprint) = 64),
        verified_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (search_id, source)
      ) STRICT;

      CREATE INDEX search_sources_verified_at_idx
        ON search_sources (source, verified_at DESC, search_id ASC);
    `);
  }
};
