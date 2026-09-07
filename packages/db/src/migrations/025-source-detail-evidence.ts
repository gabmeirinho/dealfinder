import type { Migration } from "./types.js";
export const sourceDetailEvidenceMigration: Migration = {
  version: 25,
  name: "source_detail_evidence",
  up(database) {
    database.exec(`ALTER TABLE listing_detail_facts ADD COLUMN source TEXT NOT NULL DEFAULT 'facebook' CHECK (source IN ('facebook', 'standvirtual'));
      ALTER TABLE listing_detail_facts ADD COLUMN evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json));`);
  }
};
