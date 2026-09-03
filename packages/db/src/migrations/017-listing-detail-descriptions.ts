import type { Migration } from "./types.js";

export const listingDetailDescriptionsMigration: Migration = {
  version: 17,
  name: "listing_detail_descriptions",
  up(database) {
    database.exec(`
      CREATE TABLE listing_detail_descriptions (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 20000),
        captured_at TEXT NOT NULL
      ) STRICT;
    `);
  }
};
