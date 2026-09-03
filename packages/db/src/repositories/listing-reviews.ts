import type { DatabaseSync } from "node:sqlite";

export type ListingReviewState =
  | "new"
  | "shortlisted"
  | "contacted"
  | "viewing_arranged"
  | "rejected"
  | "bought";

export interface ListingReview {
  listingId: number;
  state: ListingReviewState;
  archived: boolean;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListingNote {
  id: number;
  listingId: number;
  body: string;
  createdAt: string;
}

interface ReviewRow {
  listing_id: number;
  state: ListingReviewState;
  archived: number;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: number;
  listing_id: number;
  body: string;
  created_at: string;
}

const STATES: readonly ListingReviewState[] = [
  "new", "shortlisted", "contacted", "viewing_arranged", "rejected", "bought"
];

export class ListingReviewsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public get(listingId: number): ListingReview | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, state, archived, rejection_reason, created_at, updated_at
      FROM listing_reviews WHERE listing_id = ?
    `).get(listingId) as unknown as ReviewRow | undefined;
    return row === undefined ? undefined : mapReview(row);
  }

  public setState(
    listingId: number,
    state: ListingReviewState,
    rejectionReason: string | null,
    updatedAt: string
  ): ListingReview {
    if (!STATES.includes(state)) throw new Error("Invalid review state");
    timestamp(updatedAt);
    const reason = rejectionReason?.trim() || null;
    if (state === "rejected" && reason !== null && reason.length > 1000) {
      throw new Error("Rejection reason must contain at most 1000 characters");
    }
    const result = this.database.prepare(`
      UPDATE listing_reviews
      SET state = ?, rejection_reason = ?, updated_at = ?
      WHERE listing_id = ?
    `).run(state, state === "rejected" ? reason : null, updatedAt, listingId);
    if (Number(result.changes) !== 1) throw new Error(`Listing review not found: ${listingId}`);
    return this.get(listingId) as ListingReview;
  }

  public setArchived(listingId: number, archived: boolean, updatedAt: string): ListingReview {
    timestamp(updatedAt);
    const result = this.database.prepare(`
      UPDATE listing_reviews SET archived = ?, updated_at = ? WHERE listing_id = ?
    `).run(archived ? 1 : 0, updatedAt, listingId);
    if (Number(result.changes) !== 1) throw new Error(`Listing review not found: ${listingId}`);
    return this.get(listingId) as ListingReview;
  }

  public addNote(listingId: number, body: string, createdAt: string): ListingNote {
    const clean = body.trim();
    if (clean.length === 0 || clean.length > 4000) {
      throw new Error("Note must contain 1-4000 characters");
    }
    timestamp(createdAt);
    const result = this.database.prepare(`
      INSERT INTO listing_notes (listing_id, body, created_at) VALUES (?, ?, ?)
    `).run(listingId, clean, createdAt);
    const row = this.database.prepare(`
      SELECT id, listing_id, body, created_at FROM listing_notes WHERE id = ?
    `).get(Number(result.lastInsertRowid)) as unknown as NoteRow;
    return mapNote(row);
  }

  public listNotes(listingId: number): ListingNote[] {
    return (this.database.prepare(`
      SELECT id, listing_id, body, created_at FROM listing_notes
      WHERE listing_id = ? ORDER BY created_at DESC, id DESC
    `).all(listingId) as unknown as NoteRow[]).map(mapNote);
  }
}

function mapReview(row: ReviewRow): ListingReview {
  return {
    listingId: row.listing_id,
    state: row.state,
    archived: row.archived === 1,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapNote(row: NoteRow): ListingNote {
  return { id: row.id, listingId: row.listing_id, body: row.body, createdAt: row.created_at };
}

function timestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Timestamp must be valid ISO time");
}
