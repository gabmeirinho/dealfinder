import type { Migration } from "./types.js";

export const createRawCandidatesMigration: Migration = {
  version: 4,
  name: "create_raw_candidates",
  up(database) {
    database.exec(`
      CREATE TABLE raw_candidates (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('facebook')),
        source_listing_id TEXT NOT NULL CHECK (length(source_listing_id) BETWEEN 1 AND 100),
        listing_url TEXT NOT NULL CHECK (length(listing_url) BETWEEN 1 AND 4096),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE (source, source_listing_id)
      ) STRICT;

      CREATE TABLE raw_candidate_observations (
        id INTEGER PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES raw_candidates(id) ON DELETE CASCADE,
        search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        observed_at TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 1000),
        displayed_price TEXT CHECK (displayed_price IS NULL OR length(displayed_price) BETWEEN 1 AND 200),
        location TEXT CHECK (location IS NULL OR length(location) BETWEEN 1 AND 500),
        thumbnail_url TEXT CHECK (thumbnail_url IS NULL OR length(thumbnail_url) BETWEEN 1 AND 4096),
        raw_card_facts_json TEXT NOT NULL CHECK (json_valid(raw_card_facts_json)),
        UNIQUE (candidate_id, search_id, observed_at)
      ) STRICT;

      CREATE INDEX raw_candidate_observations_search_time_idx
        ON raw_candidate_observations (search_id, observed_at DESC, id DESC);
      CREATE INDEX raw_candidates_last_seen_idx
        ON raw_candidates (source, last_seen_at DESC, id DESC);
    `);
  }
};
