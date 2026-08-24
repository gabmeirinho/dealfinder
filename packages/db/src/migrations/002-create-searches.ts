import type { Migration } from "./types.js";

export const createSearchesMigration: Migration = {
  version: 2,
  name: "create_searches",
  up(database) {
    database.exec(`
      CREATE TABLE searches (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
        name TEXT NOT NULL CHECK (
          length(name) BETWEEN 1 AND 100
          AND name = trim(name)
        ),
        priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 1000),
        is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
        criteria_json TEXT NOT NULL CHECK (json_valid(criteria_json)),
        location_mode TEXT NOT NULL CHECK (location_mode IN ('radius', 'nationwide')),
        origin TEXT,
        radius_km INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (
            location_mode = 'radius'
            AND origin IS NOT NULL
            AND length(origin) BETWEEN 1 AND 160
            AND origin = trim(origin)
            AND radius_km IN (25, 50, 100, 150, 250, 500)
          )
          OR
          (
            location_mode = 'nationwide'
            AND origin IS NULL
            AND radius_km IS NULL
          )
        )
      ) STRICT;

      CREATE INDEX searches_priority_idx
        ON searches (is_active DESC, priority ASC, created_at ASC, id ASC);
    `);
  }
};
