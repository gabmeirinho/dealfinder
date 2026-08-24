import type { Migration } from "./types.js";

export const createGeocodingCacheMigration: Migration = {
  version: 9,
  name: "create_geocoding_cache",
  up(database) {
    database.exec(`
      CREATE TABLE locality_geocode_cache (
        provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 100),
        locality_key TEXT NOT NULL CHECK (length(locality_key) BETWEEN 1 AND 500),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 500),
        status TEXT NOT NULL CHECK (status IN ('resolved', 'not_found')),
        latitude REAL,
        longitude REAL,
        attribution TEXT NOT NULL CHECK (length(attribution) BETWEEN 1 AND 1000),
        rate_limit_policy TEXT NOT NULL CHECK (length(rate_limit_policy) BETWEEN 1 AND 1000),
        cached_at TEXT NOT NULL,
        PRIMARY KEY (provider, locality_key),
        CHECK (
          (status = 'resolved' AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
          OR (status = 'not_found' AND latitude IS NULL AND longitude IS NULL)
        )
      ) WITHOUT ROWID, STRICT;

      CREATE TABLE listing_distances (
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('approximate', 'unknown', 'not_applicable')),
        origin_locality_key TEXT,
        listing_locality_key TEXT,
        approximate_distance_km REAL CHECK (
          approximate_distance_km IS NULL OR approximate_distance_km >= 0
        ),
        within_configured_radius INTEGER CHECK (
          within_configured_radius IS NULL OR within_configured_radius IN (0, 1)
        ),
        method TEXT CHECK (method IS NULL OR method = 'straight_line'),
        display_label TEXT NOT NULL CHECK (length(display_label) BETWEEN 1 AND 200),
        unknown_reason TEXT CHECK (unknown_reason IS NULL OR unknown_reason IN (
          'missing_listing_locality', 'origin_not_found', 'listing_not_found', 'provider_error'
        )),
        provider TEXT,
        attribution TEXT,
        calculated_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, search_id),
        CHECK (
          (status = 'approximate' AND approximate_distance_km IS NOT NULL
            AND within_configured_radius IS NOT NULL AND method = 'straight_line'
            AND unknown_reason IS NULL AND provider IS NOT NULL AND attribution IS NOT NULL)
          OR (status = 'unknown' AND approximate_distance_km IS NULL
            AND within_configured_radius IS NULL AND method IS NULL AND unknown_reason IS NOT NULL)
          OR (status = 'not_applicable' AND approximate_distance_km IS NULL
            AND within_configured_radius IS NULL AND method IS NULL AND unknown_reason IS NULL
            AND provider IS NULL AND attribution IS NULL)
        )
      ) WITHOUT ROWID, STRICT;

      CREATE INDEX listing_distances_search_idx
        ON listing_distances (search_id, status, approximate_distance_km, listing_id);
    `);
  }
};
