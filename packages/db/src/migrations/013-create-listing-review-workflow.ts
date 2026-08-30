import type { Migration } from "./types.js";

export const createListingReviewWorkflowMigration: Migration = {
  version: 13,
  name: "create_listing_review_workflow",
  up(database) {
    database.exec(`
      CREATE TABLE listing_reviews (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN (
          'new', 'shortlisted', 'contacted', 'viewing_arranged', 'rejected', 'bought'
        )),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        rejection_reason TEXT CHECK (
          rejection_reason IS NULL OR length(rejection_reason) BETWEEN 1 AND 1000
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (state = 'rejected' OR rejection_reason IS NULL)
      ) STRICT;

      CREATE TABLE listing_notes (
        id INTEGER PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX listing_reviews_inbox_idx
        ON listing_reviews (archived, state, updated_at DESC, listing_id DESC);
      CREATE INDEX listing_notes_listing_idx
        ON listing_notes (listing_id, created_at DESC, id DESC);

      INSERT INTO listing_reviews (
        listing_id, state, archived, rejection_reason, created_at, updated_at
      )
      SELECT id, 'new', 0, NULL, created_at, updated_at FROM listings;
    `);
  }
};
