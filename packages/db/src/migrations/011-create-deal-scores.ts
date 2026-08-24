import type { Migration } from "./types.js";

export const createDealScoresMigration: Migration = {
  version: 11,
  name: "create_deal_scores",
  up(database) {
    database.exec(`
      CREATE TABLE comparable_cohorts (
        subject_listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        criteria_json TEXT NOT NULL CHECK (json_valid(criteria_json)),
        candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
        comparable_count INTEGER NOT NULL CHECK (comparable_count >= 0),
        excluded_outlier_count INTEGER NOT NULL CHECK (excluded_outlier_count >= 0),
        excluded_outlier_ids_json TEXT NOT NULL CHECK (json_valid(excluded_outlier_ids_json)),
        median_price_cents INTEGER CHECK (median_price_cents IS NULL OR median_price_cents >= 0),
        market_data_status TEXT NOT NULL CHECK (market_data_status IN ('sufficient', 'insufficient')),
        calculated_at TEXT NOT NULL,
        PRIMARY KEY (subject_listing_id, search_id),
        CHECK (
          (market_data_status = 'sufficient' AND comparable_count >= 5 AND median_price_cents IS NOT NULL)
          OR (market_data_status = 'insufficient' AND comparable_count < 5 AND median_price_cents IS NULL)
        ),
        CHECK (candidate_count = comparable_count + excluded_outlier_count)
      ) WITHOUT ROWID, STRICT;

      CREATE TABLE comparable_cohort_members (
        subject_listing_id INTEGER NOT NULL,
        search_id TEXT NOT NULL,
        comparable_listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 100000),
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        PRIMARY KEY (subject_listing_id, search_id, comparable_listing_id),
        UNIQUE (subject_listing_id, search_id, ordinal),
        FOREIGN KEY (subject_listing_id, search_id)
          REFERENCES comparable_cohorts(subject_listing_id, search_id) ON DELETE CASCADE,
        CHECK (subject_listing_id <> comparable_listing_id)
      ) WITHOUT ROWID, STRICT;

      CREATE TABLE listing_deal_scores (
        listing_id INTEGER NOT NULL,
        search_id TEXT NOT NULL,
        score_version INTEGER NOT NULL CHECK (score_version = 1),
        total_score INTEGER NOT NULL CHECK (total_score BETWEEN 0 AND 100),
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
        market_data_status TEXT NOT NULL CHECK (market_data_status IN ('sufficient', 'insufficient')),
        market_data_label TEXT NOT NULL CHECK (market_data_label IN (
          'Market data available', 'Insufficient market data'
        )),
        median_price_cents INTEGER CHECK (median_price_cents IS NULL OR median_price_cents >= 0),
        comparable_count INTEGER NOT NULL CHECK (comparable_count >= 0),
        discount_percent REAL,
        components_json TEXT NOT NULL CHECK (json_valid(components_json)),
        scored_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, search_id),
        FOREIGN KEY (listing_id, search_id)
          REFERENCES comparable_cohorts(subject_listing_id, search_id) ON DELETE CASCADE,
        CHECK (
          (market_data_status = 'sufficient' AND comparable_count >= 5 AND median_price_cents IS NOT NULL)
          OR (market_data_status = 'insufficient' AND comparable_count < 5
            AND median_price_cents IS NULL AND discount_percent IS NULL)
        )
      ) WITHOUT ROWID, STRICT;

      CREATE INDEX listing_deal_scores_rank_idx
        ON listing_deal_scores (search_id, total_score DESC, listing_id ASC);
      CREATE INDEX comparable_cohort_members_listing_idx
        ON comparable_cohort_members (comparable_listing_id, subject_listing_id, search_id);
    `);
  }
};
