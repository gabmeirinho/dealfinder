import type { DatabaseSync } from "node:sqlite";

export interface ListingDetailDescription {
  listingId: number;
  description: string;
  capturedAt: string;
}

interface DescriptionRow {
  listing_id: number;
  description: string;
  captured_at: string;
}

export class ListingDetailDescriptionsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public save(listingId: number, description: string, capturedAt: string): ListingDetailDescription {
    const clean = description.trim();
    if (clean.length === 0 || clean.length > 20_000) {
      throw new Error("Listing description must contain 1-20000 characters");
    }
    timestamp(capturedAt);
    this.database.prepare(`
      INSERT INTO listing_detail_descriptions (listing_id, description, captured_at)
      VALUES (?, ?, ?)
      ON CONFLICT(listing_id) DO UPDATE SET
        description = excluded.description,
        captured_at = excluded.captured_at
    `).run(listingId, clean, capturedAt);
    return this.get(listingId) as ListingDetailDescription;
  }

  public get(listingId: number): ListingDetailDescription | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, description, captured_at
      FROM listing_detail_descriptions WHERE listing_id = ?
    `).get(listingId) as unknown as DescriptionRow | undefined;
    return row === undefined ? undefined : {
      listingId: row.listing_id,
      description: row.description,
      capturedAt: row.captured_at
    };
  }
}

function timestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Captured at must be a valid ISO timestamp");
}
