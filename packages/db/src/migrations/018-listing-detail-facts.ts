import type { Migration } from "./types.js";

export const listingDetailFactsMigration: Migration = {
  version: 18,
  name: "listing_detail_facts",
  up(database) {
    database.exec(`
      CREATE TABLE listing_detail_facts (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        structured_facts_json TEXT NOT NULL CHECK (json_valid(structured_facts_json)),
        text_facts_json TEXT NOT NULL CHECK (json_valid(text_facts_json)),
        selected_facts_json TEXT NOT NULL CHECK (json_valid(selected_facts_json)),
        conflicts_json TEXT NOT NULL CHECK (json_valid(conflicts_json)),
        captured_at TEXT NOT NULL
      ) STRICT;
    `);
  }
};
