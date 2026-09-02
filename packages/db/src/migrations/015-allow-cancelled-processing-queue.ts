import type { Migration } from "./types.js";

export const allowCancelledProcessingQueueMigration: Migration = {
  version: 15,
  name: "allow_cancelled_processing_queue",
  up(database) {
    database.exec(`
      CREATE TABLE processing_queue_v15 (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
        source_normalized_at TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error_code TEXT
      ) STRICT;

      INSERT INTO processing_queue_v15 (
        listing_id, state, source_normalized_at, requested_at, available_at,
        started_at, completed_at, attempts, last_error_code
      )
      SELECT
        listing_id, state, source_normalized_at, requested_at, available_at,
        started_at, completed_at, attempts, last_error_code
      FROM processing_queue;

      DROP TABLE processing_queue;
      ALTER TABLE processing_queue_v15 RENAME TO processing_queue;

      CREATE INDEX processing_queue_ready_idx
        ON processing_queue (state, available_at, requested_at, listing_id);
    `);
  }
};
