import type { DatabaseSync } from "node:sqlite";

export type ListingDetailCaptureAttemptState = "processing" | "succeeded" | "failed";

export interface ListingDetailCaptureAttempt {
  listingId: number;
  state: ListingDetailCaptureAttemptState;
  attemptedAt: string;
  completedAt: string | null;
  nextAttemptAt: string;
  lastErrorCode: string | null;
}

interface AttemptRow {
  listing_id: number;
  state: ListingDetailCaptureAttemptState;
  attempted_at: string;
  completed_at: string | null;
  next_attempt_at: string;
  last_error_code: string | null;
}

export class ListingDetailCaptureAttemptsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public begin(listingId: number, attemptedAt: string): ListingDetailCaptureAttempt {
    validateListingId(listingId);
    timestamp(attemptedAt, "Attempted at");
    this.database.prepare(`
      INSERT INTO listing_detail_capture_attempts (
        listing_id, state, attempted_at, completed_at, next_attempt_at, last_error_code
      ) VALUES (?, 'processing', ?, NULL, ?, NULL)
      ON CONFLICT(listing_id) DO UPDATE SET
        state = 'processing',
        attempted_at = excluded.attempted_at,
        completed_at = NULL,
        next_attempt_at = excluded.next_attempt_at,
        last_error_code = NULL
    `).run(listingId, attemptedAt, attemptedAt);
    return this.get(listingId) as ListingDetailCaptureAttempt;
  }

  public completeSuccess(
    listingId: number,
    completedAt: string,
    nextAttemptAt: string
  ): ListingDetailCaptureAttempt {
    return this.complete(listingId, "succeeded", completedAt, nextAttemptAt, null);
  }

  public completeFailure(
    listingId: number,
    completedAt: string,
    nextAttemptAt: string,
    errorCode: string
  ): ListingDetailCaptureAttempt {
    const cleanCode = errorCode.trim().slice(0, 100);
    if (cleanCode.length === 0) throw new Error("Detail capture error code is required");
    return this.complete(listingId, "failed", completedAt, nextAttemptAt, cleanCode);
  }

  public recoverInterrupted(at: string, nextAttemptAt: string): number {
    timestamp(at, "Recovery time");
    timestamp(nextAttemptAt, "Next attempt at");
    const result = this.database.prepare(`
      UPDATE listing_detail_capture_attempts
      SET state = 'failed', completed_at = ?, next_attempt_at = ?, last_error_code = 'interrupted'
      WHERE state = 'processing'
    `).run(at, nextAttemptAt);
    return Number(result.changes);
  }

  public findNextEligible(
    searchId: string,
    at: string,
    detailFreshBefore: string
  ): number | undefined {
    if (searchId.trim() === "") throw new Error("Search ID is required");
    timestamp(at, "Eligibility time");
    timestamp(detailFreshBefore, "Detail freshness boundary");
    const row = this.database.prepare(`
      SELECT listings.id
      FROM listings
      JOIN listing_searches links
        ON links.listing_id = listings.id AND links.search_id = ?
      JOIN listing_match_evaluations matches
        ON matches.listing_id = listings.id
       AND matches.search_id = links.search_id
       AND matches.match_status <> 'excluded'
      LEFT JOIN listing_detail_facts details ON details.listing_id = listings.id
      LEFT JOIN listing_detail_capture_attempts attempts ON attempts.listing_id = listings.id
      WHERE listings.source = 'facebook'
        AND listings.availability = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM listing_classifications excluded
          WHERE excluded.listing_id = listings.id AND excluded.decision = 'exclude'
        )
        AND (details.listing_id IS NULL OR details.captured_at < ?)
        AND (attempts.listing_id IS NULL OR attempts.next_attempt_at <= ?)
        AND (attempts.state IS NULL OR attempts.state <> 'processing')
      ORDER BY CASE WHEN matches.match_status = 'needs_information' THEN 0 ELSE 1 END,
      COALESCE((
        SELECT MAX(scores.total_score)
        FROM listing_deal_scores scores
        WHERE scores.listing_id = listings.id AND scores.search_id = links.search_id
      ), -1) DESC,
      listings.last_seen_at DESC,
      listings.id ASC
      LIMIT 1
    `).get(searchId, detailFreshBefore, at) as unknown as { id: number } | undefined;
    return row?.id;
  }

  public get(listingId: number): ListingDetailCaptureAttempt | undefined {
    validateListingId(listingId);
    const row = this.database.prepare(`
      SELECT listing_id, state, attempted_at, completed_at, next_attempt_at, last_error_code
      FROM listing_detail_capture_attempts
      WHERE listing_id = ?
    `).get(listingId) as unknown as AttemptRow | undefined;
    return row === undefined ? undefined : mapAttempt(row);
  }

  private complete(
    listingId: number,
    state: Exclude<ListingDetailCaptureAttemptState, "processing">,
    completedAt: string,
    nextAttemptAt: string,
    errorCode: string | null
  ): ListingDetailCaptureAttempt {
    validateListingId(listingId);
    timestamp(completedAt, "Completed at");
    timestamp(nextAttemptAt, "Next attempt at");
    const result = this.database.prepare(`
      UPDATE listing_detail_capture_attempts
      SET state = ?, completed_at = ?, next_attempt_at = ?, last_error_code = ?
      WHERE listing_id = ? AND state = 'processing'
    `).run(state, completedAt, nextAttemptAt, errorCode, listingId);
    if (Number(result.changes) !== 1) throw new Error("Detail capture attempt is not processing");
    return this.get(listingId) as ListingDetailCaptureAttempt;
  }
}

function mapAttempt(row: AttemptRow): ListingDetailCaptureAttempt {
  return {
    listingId: row.listing_id,
    state: row.state,
    attemptedAt: row.attempted_at,
    completedAt: row.completed_at,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code
  };
}

function validateListingId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Listing ID must be positive");
}

function timestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid ISO timestamp`);
}
