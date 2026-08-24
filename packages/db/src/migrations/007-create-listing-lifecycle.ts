import type { Migration } from "./types.js";

export const createListingLifecycleMigration: Migration = {
  version: 7,
  name: "create_listing_lifecycle",
  up(database) {
    database.exec(`
      CREATE TABLE listings (
        id INTEGER PRIMARY KEY,
        raw_candidate_id INTEGER NOT NULL UNIQUE REFERENCES raw_candidates(id) ON DELETE RESTRICT,
        source TEXT NOT NULL CHECK (source IN ('facebook')),
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

      CREATE TABLE listing_searches (
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, search_id)
      ) WITHOUT ROWID, STRICT;

      CREATE TABLE listing_price_history (
        id INTEGER PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        observed_at TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        displayed_price TEXT NOT NULL CHECK (length(displayed_price) BETWEEN 1 AND 200),
        previous_price_cents INTEGER CHECK (previous_price_cents IS NULL OR previous_price_cents >= 0),
        UNIQUE (listing_id, observed_at)
      ) STRICT;

      CREATE TABLE listing_events (
        id INTEGER PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        event_key TEXT NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 1 AND 300),
        type TEXT NOT NULL CHECK (type IN ('new_listing', 'price_changed')),
        occurred_at TEXT NOT NULL,
        meaningful INTEGER NOT NULL CHECK (meaningful IN (0, 1)),
        alertable INTEGER NOT NULL CHECK (alertable IN (0, 1)),
        previous_price_cents INTEGER CHECK (previous_price_cents IS NULL OR previous_price_cents >= 0),
        price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0)
      ) STRICT;

      CREATE TABLE listing_scan_ingestions (
        search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        observed_at TEXT NOT NULL,
        initial_scan INTEGER NOT NULL CHECK (initial_scan IN (0, 1)),
        complete_snapshot INTEGER NOT NULL CHECK (complete_snapshot IN (0, 1)),
        PRIMARY KEY (search_id, observed_at)
      ) WITHOUT ROWID, STRICT;

      CREATE INDEX listings_availability_seen_idx
        ON listings (availability, last_seen_at ASC, id ASC);
      CREATE INDEX listing_searches_search_idx
        ON listing_searches (search_id, listing_id);
      CREATE INDEX listing_price_history_listing_time_idx
        ON listing_price_history (listing_id, observed_at ASC, id ASC);
      CREATE INDEX listing_events_listing_time_idx
        ON listing_events (listing_id, occurred_at ASC, id ASC);
      CREATE INDEX listing_events_alertable_idx
        ON listing_events (alertable, occurred_at ASC, id ASC) WHERE alertable = 1;

      INSERT INTO listings (
        raw_candidate_id, source, source_listing_id, listing_url, title, displayed_price,
        current_price_cents, discovery_kind, availability, consecutive_misses,
        first_seen_at, last_seen_at, possibly_unavailable_at, inactive_at,
        sold_at, sold_reason, created_at, updated_at
      )
      SELECT
        candidates.id,
        candidates.source,
        candidates.source_listing_id,
        candidates.listing_url,
        observations.title,
        observations.displayed_price,
        NULL,
        'initial_backlog',
        'active',
        0,
        candidates.first_seen_at,
        candidates.last_seen_at,
        NULL,
        NULL,
        NULL,
        NULL,
        candidates.first_seen_at,
        candidates.last_seen_at
      FROM raw_candidates candidates
      INNER JOIN raw_candidate_observations observations ON observations.id = (
        SELECT latest.id
        FROM raw_candidate_observations latest
        WHERE latest.candidate_id = candidates.id
        ORDER BY latest.observed_at DESC, latest.id DESC
        LIMIT 1
      );

      INSERT INTO listing_searches (listing_id, search_id, first_seen_at, last_seen_at)
      SELECT
        listings.id,
        observations.search_id,
        min(observations.observed_at),
        max(observations.observed_at)
      FROM listings
      INNER JOIN raw_candidate_observations observations
        ON observations.candidate_id = listings.raw_candidate_id
      GROUP BY listings.id, observations.search_id;

      INSERT INTO listing_events (
        listing_id, event_key, type, occurred_at, meaningful, alertable,
        previous_price_cents, price_cents
      )
      SELECT
        id,
        'new:' || id,
        'new_listing',
        first_seen_at,
        1,
        0,
        NULL,
        NULL
      FROM listings;
    `);
  }
};
