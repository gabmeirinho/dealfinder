import type { DatabaseSync } from "node:sqlite";

import type {
  ListingClassification,
  MatchedListingPattern
} from "@dealfinder/domain";

interface ClassificationRow {
  listing_id: number;
  classifier_version: number;
  subject: ListingClassification["subject"];
  vehicle_condition: ListingClassification["condition"];
  decision: ListingClassification["decision"];
  matched_patterns_json: string;
  classified_at: string;
}

export interface StoredListingClassification extends ListingClassification {
  listingId: number;
  classifiedAt: string;
}

export class ListingClassificationsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public save(
    listingId: number,
    classification: ListingClassification,
    classifiedAt: string
  ): StoredListingClassification {
    if (!Number.isSafeInteger(classification.version) || classification.version < 1) {
      throw new Error("Classifier version must be a positive integer");
    }
    if (!Number.isFinite(Date.parse(classifiedAt))) {
      throw new Error("Classified at must be valid ISO time");
    }
    this.database.prepare(`
      INSERT INTO listing_classifications (
        listing_id, classifier_version, subject, vehicle_condition, decision,
        matched_patterns_json, classified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id) DO UPDATE SET
        classifier_version = excluded.classifier_version,
        subject = excluded.subject,
        vehicle_condition = excluded.vehicle_condition,
        decision = excluded.decision,
        matched_patterns_json = excluded.matched_patterns_json,
        classified_at = excluded.classified_at
    `).run(
      listingId,
      classification.version,
      classification.subject,
      classification.condition,
      classification.decision,
      JSON.stringify(classification.matchedPatterns),
      classifiedAt
    );
    return this.get(listingId) as StoredListingClassification;
  }

  public get(listingId: number): StoredListingClassification | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, classifier_version, subject, vehicle_condition, decision,
             matched_patterns_json, classified_at
      FROM listing_classifications WHERE listing_id = ?
    `).get(listingId) as unknown as ClassificationRow | undefined;
    if (row === undefined) return undefined;
    return {
      listingId: row.listing_id,
      version: row.classifier_version,
      subject: row.subject,
      condition: row.vehicle_condition,
      decision: row.decision,
      matchedPatterns: parsePatterns(row.matched_patterns_json),
      classifiedAt: row.classified_at
    };
  }
}

function parsePatterns(value: string): MatchedListingPattern[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Stored listing classification patterns must be an array");
  return parsed as MatchedListingPattern[];
}
