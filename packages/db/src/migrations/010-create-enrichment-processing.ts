import type { Migration } from "./types.js";

export const createEnrichmentProcessingMigration: Migration = {
  version: 10,
  name: "create_enrichment_processing",
  up(database) {
    database.exec(`
      CREATE TABLE processing_control (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        state TEXT NOT NULL CHECK (state IN ('active', 'credit_paused')),
        credit_pause_generation INTEGER NOT NULL CHECK (credit_pause_generation >= 0),
        paused_at TEXT,
        resumed_at TEXT,
        last_credit_test_at TEXT
      ) STRICT;

      INSERT INTO processing_control (
        singleton_id, state, credit_pause_generation, paused_at, resumed_at, last_credit_test_at
      ) VALUES (1, 'active', 0, NULL, NULL, NULL);

      CREATE TABLE processing_queue (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('queued', 'processing', 'completed', 'failed')),
        source_normalized_at TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        available_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error_code TEXT
      ) STRICT;

      CREATE TABLE enrichment_requests (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        source_normalized_at TEXT NOT NULL,
        model TEXT NOT NULL CHECK (model = 'deepseek-v4-flash'),
        status TEXT NOT NULL CHECK (status IN (
          'running', 'succeeded', 'invalid_response', 'timeout', 'rate_limited',
          'insufficient_credit', 'authentication', 'upstream_failure'
        )),
        http_status INTEGER,
        provider_request_id TEXT CHECK (provider_request_id IS NULL OR length(provider_request_id) <= 200),
        error_code TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE TABLE listing_enrichments (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL UNIQUE REFERENCES enrichment_requests(id) ON DELETE RESTRICT,
        source_normalized_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        enrichment_json TEXT NOT NULL CHECK (json_valid(enrichment_json)),
        enriched_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE processing_domain_events (
        id INTEGER PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type = 'deepseek_credit_exhausted'),
        credit_pause_generation INTEGER NOT NULL UNIQUE CHECK (credit_pause_generation > 0),
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX processing_queue_ready_idx
        ON processing_queue (state, available_at, requested_at, listing_id);
      CREATE INDEX enrichment_requests_listing_idx
        ON enrichment_requests (listing_id, started_at, id);

      INSERT INTO processing_queue (
        listing_id, state, source_normalized_at, requested_at, available_at,
        started_at, completed_at, attempts, last_error_code
      )
      SELECT listing_id, 'queued', normalized_at, normalized_at, normalized_at,
             NULL, NULL, 0, NULL
      FROM normalized_vehicle_facts;
    `);
  }
};
