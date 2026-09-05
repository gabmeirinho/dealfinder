import type { Migration } from "./types.js";

export const separateDealAssessmentsMigration: Migration = {
  version: 21,
  name: "separate_deal_assessments",
  up(database) {
    // Derived v1 scores cannot be relabelled as v2 assessments. Startup rebuilds
    // them from retained observations, enrichments, corrections, and searches.
    database.exec(`
      DROP TABLE listing_deal_scores;
      DELETE FROM comparable_cohorts;
      CREATE TABLE listing_deal_scores (
        listing_id INTEGER NOT NULL,
        search_id TEXT NOT NULL,
        score_version INTEGER NOT NULL CHECK (score_version = 2),
        assessment_json TEXT NOT NULL CHECK (json_valid(assessment_json)),
        market_discount_percent REAL,
        personal_fit_percent INTEGER CHECK (personal_fit_percent BETWEEN 0 AND 100),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        scored_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, search_id),
        FOREIGN KEY (listing_id, search_id)
          REFERENCES comparable_cohorts(subject_listing_id, search_id) ON DELETE CASCADE
      ) WITHOUT ROWID, STRICT;
      CREATE INDEX listing_deal_scores_market_idx
        ON listing_deal_scores(search_id, market_discount_percent DESC, listing_id);
      CREATE INDEX listing_deal_scores_fit_idx
        ON listing_deal_scores(search_id, personal_fit_percent DESC, listing_id);
    `);
  }
};
