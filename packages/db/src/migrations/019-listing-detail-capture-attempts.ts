import type { Migration } from "./types.js";

export const listingDetailCaptureAttemptsMigration: Migration = {
  version: 19,
  name: "listing_detail_capture_attempts",
  up(database) {
    database.exec(`
      CREATE TABLE listing_detail_capture_attempts (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('processing', 'succeeded', 'failed')),
        attempted_at TEXT NOT NULL,
        completed_at TEXT,
        next_attempt_at TEXT NOT NULL,
        last_error_code TEXT
      ) STRICT;
    `);
  }
};
