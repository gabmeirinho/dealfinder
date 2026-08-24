import type { Migration } from "./types.js";

export const createFacebookHealthMigration: Migration = {
  version: 6,
  name: "create_facebook_health",
  up(database) {
    database.exec(`
      CREATE TABLE diagnostic_artifacts (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
        failure_kind TEXT NOT NULL CHECK (failure_kind IN (
          'checkpoint', 'login_required', 'marketplace_restricted', 'consent_required',
          'rate_limited', 'empty_results', 'partial_load', 'selector_contract'
        )),
        search_id TEXT REFERENCES searches(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        screenshot_path TEXT CHECK (screenshot_path IS NULL OR length(screenshot_path) BETWEEN 1 AND 4096),
        dom_path TEXT CHECK (dom_path IS NULL OR length(dom_path) BETWEEN 1 AND 4096)
      ) STRICT;

      CREATE INDEX diagnostic_artifacts_expiry_idx
        ON diagnostic_artifacts (expires_at ASC, id ASC);

      CREATE TABLE acquisition_pauses (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
        scope TEXT NOT NULL CHECK (scope IN ('browser', 'source', 'search')),
        scope_key TEXT NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 100),
        search_id TEXT REFERENCES searches(id) ON DELETE SET NULL,
        failure_kind TEXT NOT NULL CHECK (failure_kind IN (
          'checkpoint', 'login_required', 'marketplace_restricted', 'consent_required',
          'rate_limited', 'empty_results', 'partial_load', 'selector_contract'
        )),
        detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 2000),
        diagnostic_id TEXT REFERENCES diagnostic_artifacts(id) ON DELETE SET NULL,
        paused_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;

      CREATE UNIQUE INDEX acquisition_pauses_active_scope_idx
        ON acquisition_pauses (scope, scope_key) WHERE resolved_at IS NULL;
      CREATE INDEX acquisition_pauses_active_idx
        ON acquisition_pauses (resolved_at, paused_at DESC, id ASC);
    `);
  }
};
