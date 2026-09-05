import type { Migration } from "./types.js";

/** SQLite requires rebuilding tables to widen CHECK constraints. */
export const standvirtualListingSourceMigration: Migration = {
  version: 23,
  name: "standvirtual_listing_source",
  disableForeignKeys: true,
  up(database) {
    database.exec(`
      CREATE TABLE raw_candidates_new (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('facebook', 'standvirtual')),
        source_listing_id TEXT NOT NULL CHECK (length(source_listing_id) BETWEEN 1 AND 100),
        listing_url TEXT NOT NULL CHECK (length(listing_url) BETWEEN 1 AND 4096),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE (source, source_listing_id)
      ) STRICT;

      INSERT INTO raw_candidates_new
      SELECT id, source, source_listing_id, listing_url, first_seen_at, last_seen_at
      FROM raw_candidates;
      DROP TABLE raw_candidates;
      ALTER TABLE raw_candidates_new RENAME TO raw_candidates;
      CREATE INDEX raw_candidates_last_seen_idx
        ON raw_candidates (source, last_seen_at DESC, id DESC);

      CREATE TABLE listings_new (
        id INTEGER PRIMARY KEY,
        raw_candidate_id INTEGER NOT NULL UNIQUE REFERENCES raw_candidates(id) ON DELETE RESTRICT,
        source TEXT NOT NULL CHECK (source IN ('facebook', 'standvirtual')),
        source_listing_id TEXT NOT NULL CHECK (length(source_listing_id) BETWEEN 1 AND 100),
        listing_url TEXT NOT NULL CHECK (length(listing_url) BETWEEN 1 AND 4096),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 1000),
        displayed_price TEXT CHECK (displayed_price IS NULL OR length(displayed_price) BETWEEN 1 AND 200),
        current_price_cents INTEGER CHECK (current_price_cents IS NULL OR current_price_cents >= 0),
        discovery_kind TEXT NOT NULL CHECK (discovery_kind IN ('initial_backlog', 'monitoring')),
        availability TEXT NOT NULL CHECK (availability IN ('active', 'possibly_unavailable', 'inactive', 'sold')),
        consecutive_misses INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_misses >= 0),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        possibly_unavailable_at TEXT,
        inactive_at TEXT,
        sold_at TEXT,
        sold_reason TEXT CHECK (sold_reason IS NULL OR sold_reason IN ('explicit', 'user')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source, source_listing_id),
        CHECK ((availability = 'sold') = (sold_at IS NOT NULL AND sold_reason IS NOT NULL))
      ) STRICT;

      INSERT INTO listings_new
      SELECT id, raw_candidate_id, source, source_listing_id, listing_url, title,
             displayed_price, current_price_cents, discovery_kind, availability,
             consecutive_misses, first_seen_at, last_seen_at, possibly_unavailable_at,
             inactive_at, sold_at, sold_reason, created_at, updated_at
      FROM listings;
      DROP TABLE listings;
      ALTER TABLE listings_new RENAME TO listings;
      CREATE INDEX listings_availability_seen_idx
        ON listings (availability, last_seen_at ASC, id ASC);
    `);
  }
};
