import type { Migration } from "./types.js";

export const incompleteListingMatchesMigration: Migration = {
  version: 20,
  name: "incomplete_listing_matches",
  up(database) {
    database.exec(`
      ALTER TABLE listing_match_evaluations ADD COLUMN match_status TEXT NOT NULL
        DEFAULT 'excluded' CHECK (match_status IN ('matches', 'excluded', 'needs_information'));
      ALTER TABLE listing_match_evaluations ADD COLUMN missing_criteria_json TEXT NOT NULL DEFAULT '[]';

      UPDATE listing_match_evaluations SET
        match_status = CASE
          WHEN eligible = 1 THEN 'matches'
          WHEN EXISTS (SELECT 1 FROM json_each(hard_failures_json)
            WHERE json_extract(value, '$.matched') = 0) THEN 'excluded'
          ELSE 'needs_information' END,
        missing_criteria_json = (SELECT json_group_array(json(value))
          FROM json_each(hard_failures_json) WHERE json_extract(value, '$.matched') IS NULL),
        hard_failures_json = (SELECT json_group_array(json(value))
          FROM json_each(hard_failures_json) WHERE json_extract(value, '$.matched') = 0);

      CREATE INDEX listing_matches_status ON listing_match_evaluations(search_id, match_status, listing_id);

      INSERT OR IGNORE INTO processing_queue (
        listing_id, state, source_normalized_at, requested_at, available_at,
        started_at, completed_at, attempts, last_error_code
      ) SELECT facts.listing_id, 'queued', facts.normalized_at, facts.normalized_at,
          facts.normalized_at, NULL, NULL, 0, NULL
        FROM normalized_vehicle_facts facts
        JOIN listings ON listings.id = facts.listing_id AND listings.availability = 'active'
        WHERE EXISTS (SELECT 1 FROM listing_match_evaluations matches
          JOIN searches ON searches.id = matches.search_id AND searches.is_active = 1
          WHERE matches.listing_id = facts.listing_id AND matches.match_status = 'needs_information')
        AND NOT EXISTS (SELECT 1 FROM listing_classifications classification
          WHERE classification.listing_id = facts.listing_id AND classification.decision = 'exclude');
    `);
  }
};
