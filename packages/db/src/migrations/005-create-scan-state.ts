import type { Migration } from "./types.js";

export const createScanStateMigration: Migration = {
  version: 5,
  name: "create_scan_state",
  up(database) {
    database.exec(`
      CREATE TABLE scan_runs (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
        search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL CHECK (trigger IN ('startup', 'scheduled', 'manual')),
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
        requested_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        cards_seen INTEGER NOT NULL DEFAULT 0 CHECK (cards_seen >= 0),
        new_candidates INTEGER NOT NULL DEFAULT 0 CHECK (new_candidates >= 0),
        error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100)
      ) STRICT;

      CREATE UNIQUE INDEX scan_runs_one_queued_search_idx
        ON scan_runs (search_id) WHERE state = 'queued';
      CREATE INDEX scan_runs_queue_idx
        ON scan_runs (state, requested_at ASC, id ASC);
      CREATE INDEX scan_runs_search_history_idx
        ON scan_runs (search_id, requested_at DESC, id DESC);

      CREATE TABLE scan_schedules (
        search_id TEXT PRIMARY KEY REFERENCES searches(id) ON DELETE CASCADE,
        last_scan_at TEXT,
        next_scan_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX scan_schedules_due_idx
        ON scan_schedules (next_scan_at ASC, search_id ASC)
        WHERE next_scan_at IS NOT NULL;
    `);
  }
};
