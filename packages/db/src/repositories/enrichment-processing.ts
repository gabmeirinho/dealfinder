import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  DEEPSEEK_ENRICHMENT_MODEL,
  ENRICHMENT_SCHEMA_VERSION,
  validateVehicleEnrichment,
  type VehicleEnrichment
} from "@dealfinder/domain";

import { withTransaction } from "../transactions.js";

export type ProcessingQueueState = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type EnrichmentRequestFailure =
  | "invalid_response"
  | "timeout"
  | "rate_limited"
  | "authentication"
  | "upstream_failure";

export interface ProcessingControl {
  state: "active" | "credit_paused";
  creditPauseGeneration: number;
  pausedAt: string | null;
  resumedAt: string | null;
  lastCreditTestAt: string | null;
  downstreamPaused: boolean;
}

export interface ProcessingClaim {
  requestId: string;
  listingId: number;
  sourceNormalizedAt: string;
}

export interface ProcessingQueueItem {
  listingId: number;
  state: ProcessingQueueState;
  sourceNormalizedAt: string;
  requestedAt: string;
  availableAt: string;
  attempts: number;
  lastErrorCode: string | null;
}

export interface StoredEnrichment {
  listingId: number;
  requestId: string;
  sourceNormalizedAt: string;
  enrichment: VehicleEnrichment;
  enrichedAt: string;
}

interface QueueRow {
  listing_id: number;
  state: ProcessingQueueState;
  source_normalized_at: string;
  requested_at: string;
  available_at: string;
  attempts: number;
  last_error_code: string | null;
}

interface ControlRow {
  state: ProcessingControl["state"];
  credit_pause_generation: number;
  paused_at: string | null;
  resumed_at: string | null;
  last_credit_test_at: string | null;
}

interface EnrichmentRow {
  listing_id: number;
  request_id: string;
  source_normalized_at: string;
  enrichment_json: string;
  enriched_at: string;
}

export class EnrichmentProcessingRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public enqueue(listingId: number, sourceNormalizedAt: string): ProcessingQueueItem | undefined {
    timestamp(sourceNormalizedAt, "Source normalized at");
    if (this.isExcluded(listingId)) {
      this.cancelExcluded(listingId);
      return this.getQueueItem(listingId);
    }
    this.database.prepare(`
      INSERT INTO processing_queue (
        listing_id, state, source_normalized_at, requested_at, available_at,
        started_at, completed_at, attempts, last_error_code
      ) VALUES (?, 'queued', ?, ?, ?, NULL, NULL, 0, NULL)
      ON CONFLICT(listing_id) DO UPDATE SET
        source_normalized_at = excluded.source_normalized_at,
        requested_at = CASE
          WHEN processing_queue.source_normalized_at = excluded.source_normalized_at
            AND processing_queue.state <> 'cancelled'
            THEN processing_queue.requested_at
          ELSE excluded.requested_at
        END,
        available_at = CASE
          WHEN processing_queue.source_normalized_at = excluded.source_normalized_at
            AND processing_queue.state <> 'cancelled'
            THEN processing_queue.available_at
          ELSE excluded.available_at
        END,
        state = CASE
          WHEN processing_queue.source_normalized_at = excluded.source_normalized_at
            AND processing_queue.state = 'cancelled' THEN 'queued'
          WHEN processing_queue.source_normalized_at = excluded.source_normalized_at
            THEN processing_queue.state
          WHEN processing_queue.state = 'processing' THEN 'processing'
          ELSE 'queued'
        END,
        completed_at = CASE
          WHEN processing_queue.source_normalized_at = excluded.source_normalized_at
            AND processing_queue.state <> 'cancelled'
            THEN processing_queue.completed_at
          ELSE NULL
        END,
        last_error_code = CASE
          WHEN processing_queue.source_normalized_at = excluded.source_normalized_at
            AND processing_queue.state <> 'cancelled'
            THEN processing_queue.last_error_code
          ELSE NULL
        END
    `).run(listingId, sourceNormalizedAt, sourceNormalizedAt, sourceNormalizedAt);
    return this.getQueueItem(listingId) as ProcessingQueueItem;
  }

  public cancelExcluded(listingId: number, reason = "excluded_by_classifier"): boolean {
    const result = this.database.prepare(`
      UPDATE processing_queue
      SET state = 'cancelled', started_at = NULL, completed_at = NULL,
          last_error_code = ?
      WHERE listing_id = ? AND state IN ('queued', 'processing', 'failed')
    `).run(reason, listingId);
    return Number(result.changes) === 1;
  }

  public cancelClaim(claim: ProcessingClaim, cancelledAt: string, reason = "excluded_by_classifier"): void {
    timestamp(cancelledAt, "Cancellation time");
    withTransaction(this.database, () => {
      this.finishRequest(
        claim.requestId,
        "upstream_failure",
        cancelledAt,
        null,
        null,
        reason
      );
      this.cancelExcluded(claim.listingId, reason);
    });
  }

  public recoverInterrupted(at: string): number {
    timestamp(at, "Recovery time");
    return withTransaction(this.database, () => {
      const result = this.database.prepare(`
        UPDATE processing_queue
        SET state = CASE WHEN EXISTS (
              SELECT 1 FROM listing_classifications excluded
              WHERE excluded.listing_id = processing_queue.listing_id
                AND excluded.decision = 'exclude'
            ) THEN 'cancelled' ELSE 'queued' END,
            available_at = ?, started_at = NULL,
            last_error_code = CASE WHEN EXISTS (
              SELECT 1 FROM listing_classifications excluded
              WHERE excluded.listing_id = processing_queue.listing_id
                AND excluded.decision = 'exclude'
            ) THEN 'excluded_by_classifier' ELSE 'interrupted' END
        WHERE state = 'processing'
      `).run(at);
      this.database.prepare(`
        UPDATE enrichment_requests
        SET status = 'upstream_failure', error_code = 'interrupted', completed_at = ?
        WHERE status = 'running'
      `).run(at);
      return Number(result.changes);
    });
  }

  public claimNext(at: string): ProcessingClaim | undefined {
    timestamp(at, "Claim time");
    return withTransaction(this.database, () => {
      this.cancelQueuedExcluded();
      const row = this.database.prepare(`
        UPDATE processing_queue
        SET state = 'processing', started_at = ?, attempts = attempts + 1,
            last_error_code = NULL
        WHERE listing_id = (
          SELECT queue.listing_id
          FROM processing_queue queue
          JOIN processing_control control ON control.singleton_id = 1
          WHERE control.state = 'active'
            AND queue.state = 'queued'
            AND queue.available_at <= ?
            AND NOT EXISTS (
              SELECT 1 FROM listing_classifications excluded
              WHERE excluded.listing_id = queue.listing_id
                AND excluded.decision = 'exclude'
            )
          ORDER BY queue.requested_at ASC, queue.listing_id ASC
          LIMIT 1
        )
        RETURNING listing_id, source_normalized_at
      `).get(at, at) as unknown as { listing_id: number; source_normalized_at: string } | undefined;
      if (row === undefined) return undefined;
      const requestId = randomUUID();
      this.database.prepare(`
        INSERT INTO enrichment_requests (
          id, listing_id, source_normalized_at, model, status, http_status,
          provider_request_id, error_code, started_at, completed_at
        ) VALUES (?, ?, ?, ?, 'running', NULL, NULL, NULL, ?, NULL)
      `).run(requestId, row.listing_id, row.source_normalized_at, DEEPSEEK_ENRICHMENT_MODEL, at);
      return { requestId, listingId: row.listing_id, sourceNormalizedAt: row.source_normalized_at };
    });
  }

  /** Returns false when a newer normalized version arrived while the request was running. */
  public completeSuccess(
    claim: ProcessingClaim,
    enrichment: VehicleEnrichment,
    completedAt: string,
    providerRequestId: string | null
  ): boolean {
    timestamp(completedAt, "Completion time");
    return withTransaction(this.database, () => {
      if (this.isExcluded(claim.listingId)) {
        this.finishRequest(
          claim.requestId,
          "upstream_failure",
          completedAt,
          null,
          null,
          "excluded_by_classifier"
        );
        this.cancelExcluded(claim.listingId);
        return false;
      }

      const validated = validateVehicleEnrichment(enrichment);
      this.finishRequest(claim.requestId, "succeeded", completedAt, null, providerRequestId, null);
      const current = this.getQueueItem(claim.listingId);
      const currentVersion = current?.state === "processing" &&
        current.sourceNormalizedAt === claim.sourceNormalizedAt;
      if (currentVersion) {
        this.database.prepare(`
          INSERT INTO listing_enrichments (
            listing_id, request_id, source_normalized_at, schema_version,
            enrichment_json, enriched_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(listing_id) DO UPDATE SET
            request_id = excluded.request_id,
            source_normalized_at = excluded.source_normalized_at,
            schema_version = excluded.schema_version,
            enrichment_json = excluded.enrichment_json,
            enriched_at = excluded.enriched_at
        `).run(
          claim.listingId,
          claim.requestId,
          claim.sourceNormalizedAt,
          ENRICHMENT_SCHEMA_VERSION,
          JSON.stringify(validated),
          completedAt
        );
      }
      if (currentVersion) {
        this.database.prepare(`
          UPDATE processing_queue
          SET state = 'completed', available_at = ?, started_at = NULL,
              completed_at = ?, last_error_code = NULL
          WHERE listing_id = ?
        `).run(completedAt, completedAt, claim.listingId);
      } else if (current?.sourceNormalizedAt !== claim.sourceNormalizedAt) {
        this.database.prepare(`
          UPDATE processing_queue
          SET state = 'queued', available_at = ?, started_at = NULL,
              completed_at = NULL, last_error_code = NULL
          WHERE listing_id = ? AND state = 'processing'
        `).run(completedAt, claim.listingId);
      }
      return currentVersion;
    });
  }

  public completeFailure(
    claim: ProcessingClaim,
    failure: EnrichmentRequestFailure,
    completedAt: string,
    httpStatus: number | null,
    retryAt: string | null
  ): void {
    timestamp(completedAt, "Completion time");
    if (retryAt !== null) timestamp(retryAt, "Retry time");
    withTransaction(this.database, () => {
      this.finishRequest(claim.requestId, failure, completedAt, httpStatus, null, failure);
      const current = this.getQueueItem(claim.listingId);
      if (this.isExcluded(claim.listingId)) {
        this.cancelExcluded(claim.listingId);
        return;
      }
      const changed = current?.sourceNormalizedAt !== claim.sourceNormalizedAt;
      const retry = changed || retryAt !== null;
      this.database.prepare(`
        UPDATE processing_queue
        SET state = ?, available_at = ?, started_at = NULL,
            completed_at = NULL, last_error_code = ?
        WHERE listing_id = ?
      `).run(retry ? "queued" : "failed", changed ? completedAt : (retryAt ?? completedAt), failure, claim.listingId);
    });
  }

  /** Atomically pauses all downstream work and emits one event per pause episode. */
  public pauseForInsufficientCredit(
    claim: ProcessingClaim,
    completedAt: string,
    httpStatus = 402
  ): boolean {
    timestamp(completedAt, "Completion time");
    return withTransaction(this.database, () => {
      this.finishRequest(
        claim.requestId, "insufficient_credit", completedAt, httpStatus, null, "insufficient_credit"
      );
      if (this.isExcluded(claim.listingId)) {
        this.cancelExcluded(claim.listingId);
      } else {
        this.database.prepare(`
          UPDATE processing_queue
          SET state = 'queued', available_at = ?, started_at = NULL,
              completed_at = NULL, last_error_code = 'insufficient_credit'
          WHERE listing_id = ?
        `).run(completedAt, claim.listingId);
      }
      const transitioned = this.database.prepare(`
        UPDATE processing_control
        SET state = 'credit_paused',
            credit_pause_generation = credit_pause_generation + 1,
            paused_at = ?
        WHERE singleton_id = 1 AND state = 'active'
        RETURNING credit_pause_generation
      `).get(completedAt) as unknown as { credit_pause_generation: number } | undefined;
      if (transitioned === undefined) return false;
      this.database.prepare(`
        INSERT INTO processing_domain_events (
          event_key, type, credit_pause_generation, occurred_at
        ) VALUES (?, 'deepseek_credit_exhausted', ?, ?)
      `).run(
        `deepseek_credit_exhausted:${transitioned.credit_pause_generation}`,
        transitioned.credit_pause_generation,
        completedAt
      );
      return true;
    });
  }

  public recordFailedCreditTest(testedAt: string): void {
    timestamp(testedAt, "Credit test time");
    this.database.prepare(`
      UPDATE processing_control SET last_credit_test_at = ? WHERE singleton_id = 1
    `).run(testedAt);
  }

  /** Call only after the provider balance endpoint succeeds and reports available credit. */
  public resumeAfterSuccessfulCreditTest(testedAt: string): boolean {
    timestamp(testedAt, "Credit test time");
    const result = this.database.prepare(`
      UPDATE processing_control
      SET state = 'active', resumed_at = ?, last_credit_test_at = ?
      WHERE singleton_id = 1 AND state = 'credit_paused'
    `).run(testedAt, testedAt);
    return Number(result.changes) === 1;
  }

  public getControl(): ProcessingControl {
    const row = this.database.prepare(`
      SELECT state, credit_pause_generation, paused_at, resumed_at, last_credit_test_at
      FROM processing_control WHERE singleton_id = 1
    `).get() as unknown as ControlRow;
    return {
      state: row.state,
      creditPauseGeneration: row.credit_pause_generation,
      pausedAt: row.paused_at,
      resumedAt: row.resumed_at,
      lastCreditTestAt: row.last_credit_test_at,
      downstreamPaused: row.state === "credit_paused"
    };
  }

  public getQueueItem(listingId: number): ProcessingQueueItem | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, state, source_normalized_at, requested_at,
             available_at, attempts, last_error_code
      FROM processing_queue WHERE listing_id = ?
    `).get(listingId) as unknown as QueueRow | undefined;
    return row === undefined ? undefined : {
      listingId: row.listing_id,
      state: row.state,
      sourceNormalizedAt: row.source_normalized_at,
      requestedAt: row.requested_at,
      availableAt: row.available_at,
      attempts: row.attempts,
      lastErrorCode: row.last_error_code
    };
  }

  public getEnrichment(listingId: number): StoredEnrichment | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, request_id, source_normalized_at, enrichment_json, enriched_at
      FROM listing_enrichments WHERE listing_id = ?
    `).get(listingId) as unknown as EnrichmentRow | undefined;
    if (row === undefined) return undefined;
    return mapEnrichment(row);
  }

  public listEnrichments(): StoredEnrichment[] {
    return (this.database.prepare(`
      SELECT listing_id, request_id, source_normalized_at, enrichment_json, enriched_at
      FROM listing_enrichments ORDER BY listing_id ASC
    `).all() as unknown as EnrichmentRow[]).map(mapEnrichment);
  }

  private finishRequest(
    requestId: string,
    status: string,
    completedAt: string,
    httpStatus: number | null,
    providerRequestId: string | null,
    errorCode: string | null
  ): void {
    const result = this.database.prepare(`
      UPDATE enrichment_requests
      SET status = ?, http_status = ?, provider_request_id = ?, error_code = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `).run(status, httpStatus, providerRequestId, errorCode, completedAt, requestId);
    if (Number(result.changes) !== 1) throw new Error("Enrichment request is not running");
  }

  private isExcluded(listingId: number): boolean {
    return this.database.prepare(`
      SELECT 1 AS excluded
      FROM listing_classifications
      WHERE listing_id = ? AND decision = 'exclude'
    `).get(listingId) !== undefined;
  }

  private cancelQueuedExcluded(): void {
    this.database.prepare(`
      UPDATE processing_queue
      SET state = 'cancelled', started_at = NULL, completed_at = NULL,
          last_error_code = 'excluded_by_classifier'
      WHERE state IN ('queued', 'failed')
        AND EXISTS (
          SELECT 1 FROM listing_classifications excluded
          WHERE excluded.listing_id = processing_queue.listing_id
            AND excluded.decision = 'exclude'
        )
    `).run();
  }
}

function mapEnrichment(row: EnrichmentRow): StoredEnrichment {
  return {
    listingId: row.listing_id,
    requestId: row.request_id,
    sourceNormalizedAt: row.source_normalized_at,
    enrichment: validateVehicleEnrichment(JSON.parse(row.enrichment_json) as unknown),
    enrichedAt: row.enriched_at
  };
}

function timestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}
