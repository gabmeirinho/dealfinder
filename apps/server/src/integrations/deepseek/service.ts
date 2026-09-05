import type { DatabaseConnection, EnrichmentRequestFailure } from "@dealfinder/db";
import {
  applyAuthoritativeStructuredFacts,
  applyFactCorrections,
  createEnrichmentInput
} from "@dealfinder/domain";

import { DeepSeekClient, DeepSeekError } from "./client.js";
import type { Logger } from "../../logging/index.js";

export type EnrichmentProcessResult =
  | "disabled"
  | "idle"
  | "succeeded"
  | "failed"
  | "retry_queued"
  | "excluded"
  | "credit_paused";

export interface DeepSeekEnrichmentServiceOptions {
  database: () => DatabaseConnection;
  client?: DeepSeekClient;
  enabled: boolean;
  logger: Logger;
  now?: () => Date;
  afterEnrichment?: (listingId: number, completedAt: string) => void | Promise<void>;
}

export class DeepSeekEnrichmentService {
  readonly #database: () => DatabaseConnection;
  readonly #client: DeepSeekClient | undefined;
  readonly #enabled: boolean;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #afterEnrichment: DeepSeekEnrichmentServiceOptions["afterEnrichment"];

  public constructor(options: DeepSeekEnrichmentServiceOptions) {
    this.#database = options.database;
    this.#client = options.client;
    this.#enabled = options.enabled;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#afterEnrichment = options.afterEnrichment;
  }

  public async processNext(): Promise<EnrichmentProcessResult> {
    if (!this.#enabled || this.#client === undefined) return "disabled";
    const database = this.#database();
    if (database.enrichmentProcessing.getControl().downstreamPaused) return "credit_paused";
    const startedAt = this.#now().toISOString();
    const claim = database.enrichmentProcessing.claimNext(startedAt);
    if (claim === undefined) return "idle";
    if (database.listingClassifications.get(claim.listingId)?.decision === "exclude") {
      database.enrichmentProcessing.cancelClaim(claim, this.#now().toISOString());
      this.#logger.info(
        "DeepSeek enrichment skipped excluded listing",
        safeContext(claim, "excluded_by_classifier")
      );
      return "excluded";
    }
    const stored = database.normalizedVehicles.getFacts(claim.listingId);
    if (stored === undefined) {
      database.enrichmentProcessing.completeFailure(
        claim, "upstream_failure", this.#now().toISOString(), null, null
      );
      this.#logger.error("DeepSeek enrichment source facts missing", safeContext(claim, "source_facts_missing"));
      return "failed";
    }

    try {
      const effectiveFacts = applyFactCorrections(
        stored.facts,
        database.corrections.listForListing(claim.listingId)
      );
      const detailFacts = database.listingDetailFacts.get(claim.listingId);
      const result = await this.#client.enrich(createEnrichmentInput(
        effectiveFacts,
        detailFacts === undefined ? undefined : {
          mileageKm: detailFacts.mileage,
          structuredVehicle: detailFacts.structuredFacts
        }
      ));
      const completedAt = this.#now().toISOString();
      const authoritative = applyAuthoritativeStructuredFacts(
        result.enrichment,
        effectiveFacts,
        detailFacts?.structuredFacts,
        new Set(database.corrections.listForListing(claim.listingId).map(({ field }) => field))
      );
      const advanced = database.enrichmentProcessing.completeSuccess(
        claim, authoritative, completedAt, result.providerRequestId
      );
      if (advanced && this.#afterEnrichment !== undefined) {
        try {
          await this.#afterEnrichment(claim.listingId, completedAt);
        } catch {
          this.#logger.error(
            "Deal score recomputation failed after enrichment",
            safeContext(claim, "score_recomputation_failed")
          );
        }
      }
      this.#logger.info("DeepSeek enrichment completed", safeContext(claim, advanced ? "succeeded" : "superseded"));
      return advanced ? "succeeded" : "retry_queued";
    } catch (error: unknown) {
      const failure = error instanceof DeepSeekError
        ? error
        : new DeepSeekError("upstream_failure", "Unexpected DeepSeek integration failure");
      const completedAt = this.#now().toISOString();
      if (failure.kind === "insufficient_credit") {
        const emitted = database.enrichmentProcessing.pauseForInsufficientCredit(
          claim, completedAt, failure.httpStatus ?? 402
        );
        this.#logger.warn("DeepSeek processing paused for insufficient credit", {
          ...safeContext(claim, failure.kind), domainEventEmitted: emitted, httpStatus: failure.httpStatus
        });
        return "credit_paused";
      }
      const retryAt = retryTime(failure.kind, completedAt);
      database.enrichmentProcessing.completeFailure(
        claim,
        failure.kind as EnrichmentRequestFailure,
        completedAt,
        failure.httpStatus,
        retryAt
      );
      this.#logger.warn("DeepSeek enrichment did not advance", {
        ...safeContext(claim, failure.kind), httpStatus: failure.httpStatus, retryQueued: retryAt !== null
      });
      return retryAt === null ? "failed" : "retry_queued";
    }
  }

  public async testCreditAndResume(): Promise<boolean> {
    if (!this.#enabled || this.#client === undefined) return false;
    const testedAt = this.#now().toISOString();
    try {
      const available = await this.#client.hasAvailableCredit();
      if (!available) {
        this.#database().enrichmentProcessing.recordFailedCreditTest(testedAt);
        this.#logger.warn("DeepSeek credit test did not report available credit");
        return false;
      }
      const resumed = this.#database().enrichmentProcessing.resumeAfterSuccessfulCreditTest(testedAt);
      this.#logger.info("DeepSeek credit test succeeded", { processingResumed: resumed });
      return true;
    } catch (error: unknown) {
      this.#database().enrichmentProcessing.recordFailedCreditTest(testedAt);
      const failure = error instanceof DeepSeekError ? error : undefined;
      this.#logger.warn("DeepSeek credit test failed", {
        code: failure?.kind ?? "upstream_failure", httpStatus: failure?.httpStatus ?? null
      });
      return false;
    }
  }
}

function retryTime(kind: string, completedAt: string): string | null {
  const delay = kind === "rate_limited" ? 60_000 : kind === "timeout" ? 15_000 :
    kind === "upstream_failure" ? 30_000 : null;
  return delay === null ? null : new Date(Date.parse(completedAt) + delay).toISOString();
}

function safeContext(
  claim: { listingId: number; requestId: string },
  code: string
): { listingId: number; requestId: string; code: string } {
  return { listingId: claim.listingId, requestId: claim.requestId, code };
}
