import type { Migration } from "./types.js";

export const captureListingDescriptionsMigration: Migration = {
  version: 16,
  name: "capture_listing_descriptions",
  up(database) {
    const columns = database.prepare("PRAGMA table_info(raw_candidate_observations)").all() as unknown as Array<{ name: string }>;
    if (columns.some((column) => column.name === "description")) return;
    database.exec(`
      ALTER TABLE raw_candidate_observations
        ADD COLUMN description TEXT CHECK (
          description IS NULL OR length(description) BETWEEN 1 AND 20000
        );
    `);
  }
};
