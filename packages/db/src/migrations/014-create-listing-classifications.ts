import type { Migration } from "./types.js";

export const createListingClassificationsMigration: Migration = {
  version: 14,
  name: "create_listing_classifications",
  up(database) {
    database.exec(`
      CREATE TABLE listing_classifications (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        classifier_version INTEGER NOT NULL CHECK (classifier_version >= 1),
        subject TEXT NOT NULL CHECK (subject IN (
          'whole_vehicle', 'part_or_accessory', 'collectible', 'printed_material', 'unknown'
        )),
        vehicle_condition TEXT NOT NULL CHECK (vehicle_condition IN ('parts_only', 'unknown')),
        decision TEXT NOT NULL CHECK (decision IN ('continue', 'exclude')),
        matched_patterns_json TEXT NOT NULL CHECK (json_valid(matched_patterns_json)),
        classified_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX listing_classifications_decision_idx
        ON listing_classifications (decision, subject, listing_id);
    `);
  }
};
