import type { Migration } from "./types.js";

export const createDuplicateGroupsMigration: Migration = {
  version: 12,
  name: "create_duplicate_groups",
  up(database) {
    database.exec(`
      CREATE TABLE listing_fingerprints (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        fingerprint_version INTEGER NOT NULL CHECK (fingerprint_version = 1),
        text_sha256 TEXT NOT NULL CHECK (length(text_sha256) = 64),
        text_token_count INTEGER NOT NULL CHECK (text_token_count >= 0),
        vehicle_sha256 TEXT NOT NULL CHECK (length(vehicle_sha256) = 64),
        vehicle_fingerprint_json TEXT NOT NULL CHECK (json_valid(vehicle_fingerprint_json)),
        image_difference_hash TEXT CHECK (image_difference_hash IS NULL OR length(image_difference_hash) = 16),
        computed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE listing_thumbnails (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        source_url_sha256 TEXT NOT NULL CHECK (length(source_url_sha256) = 64),
        relative_path TEXT NOT NULL UNIQUE CHECK (
          length(relative_path) BETWEEN 1 AND 200 AND instr(relative_path, '..') = 0
        ),
        content_type TEXT NOT NULL CHECK (content_type = 'image/webp'),
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
        width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 512),
        height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 512),
        cached_at TEXT NOT NULL,
        expires_at TEXT
      ) STRICT;

      CREATE TABLE duplicate_groups (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        confidence TEXT NOT NULL CHECK (confidence IN ('medium', 'high')),
        explanation TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 1000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE duplicate_group_members (
        group_id TEXT NOT NULL REFERENCES duplicate_groups(id) ON DELETE CASCADE,
        listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        PRIMARY KEY (group_id, listing_id),
        UNIQUE (group_id, ordinal)
      ) WITHOUT ROWID, STRICT;

      CREATE TABLE duplicate_pair_evidence (
        group_id TEXT NOT NULL REFERENCES duplicate_groups(id) ON DELETE CASCADE,
        left_listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        right_listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        confidence TEXT NOT NULL CHECK (confidence IN ('medium', 'high')),
        vehicle_similarity REAL NOT NULL CHECK (vehicle_similarity BETWEEN 0 AND 1),
        text_similarity REAL NOT NULL CHECK (text_similarity BETWEEN 0 AND 1),
        image_similarity REAL CHECK (image_similarity IS NULL OR image_similarity BETWEEN 0 AND 1),
        explanation TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 1000),
        PRIMARY KEY (group_id, left_listing_id, right_listing_id),
        CHECK (left_listing_id < right_listing_id)
      ) WITHOUT ROWID, STRICT;

      CREATE INDEX listing_fingerprints_vehicle_idx
        ON listing_fingerprints (vehicle_sha256, listing_id);
      CREATE INDEX listing_fingerprints_image_idx
        ON listing_fingerprints (image_difference_hash, listing_id)
        WHERE image_difference_hash IS NOT NULL;
      CREATE INDEX listing_thumbnails_expiry_idx
        ON listing_thumbnails (expires_at, listing_id) WHERE expires_at IS NOT NULL;
      CREATE INDEX duplicate_group_members_group_idx
        ON duplicate_group_members (group_id, ordinal, listing_id);
    `);
  }
};
