import type { DatabaseConnection, StoredDuplicateGroup, StoredEnrichment } from "@dealfinder/db";
import {
  applyAuthoritativeStructuredFacts,
  applyFactCorrections,
  createDuplicateTextTokens,
  createVehicleDuplicateFingerprint,
  enrichmentFromNormalizedFacts,
  groupProbableDuplicates,
  type DuplicateCandidateFingerprint,
  type NormalizedFactField,
  type NormalizedVehicleFacts,
  type VehicleEnrichment
} from "@dealfinder/domain";

import type { Logger } from "../../logging/index.js";
import { ThumbnailStorage } from "./thumbnail-storage.js";

export interface DuplicateDetectionServiceOptions {
  database: () => DatabaseConnection;
  thumbnails: ThumbnailStorage;
  logger: Logger;
}

export class DuplicateDetectionService {
  readonly #database: () => DatabaseConnection;
  readonly #thumbnails: ThumbnailStorage;
  readonly #logger: Logger;

  public constructor(options: DuplicateDetectionServiceOptions) {
    this.#database = options.database;
    this.#thumbnails = options.thumbnails;
    this.#logger = options.logger;
  }

  public async recomputeAll(computedAt: string): Promise<StoredDuplicateGroup[]> {
    validateTimestamp(computedAt);
    const database = this.#database();
    await this.#thumbnails.cleanupExpired(computedAt);
    const enrichments = new Map(database.enrichmentProcessing.listEnrichments()
      .map((stored) => [stored.listingId, stored]));
    const candidates: DuplicateCandidateFingerprint[] = [];
    for (const normalized of database.normalizedVehicles.listFacts()) {
      const listing = database.listings.get(normalized.listingId);
      if (listing === undefined) continue;
      this.#thumbnails.syncRetention(listing.id, listing.inactiveAt);

      const corrections = database.corrections.listForListing(listing.id);
      const facts = applyFactCorrections(normalized.facts, corrections);
      const stored = enrichments.get(listing.id);
      const enrichment = stored !== undefined && stored.sourceNormalizedAt >= normalized.normalizedAt
        ? resolveEnrichment(
            stored,
            facts,
            new Set(corrections.map(({ field }) => field)),
            database.listingDetailFacts.get(listing.id)?.structuredFacts
          )
        : enrichmentFromNormalizedFacts(facts);
      const textTokens = createDuplicateTextTokens([
        facts.original.title,
        facts.original.description ?? "",
        ...facts.original.cardFacts
      ].join(" "));
      let imageDifferenceHash = database.duplicates.getFingerprint(listing.id)?.imageDifferenceHash ?? null;
      const observations = database.rawCandidates.listObservations(listing.rawCandidateId);
      const thumbnailUrl = [...observations].reverse().find(({ thumbnailUrl }) => thumbnailUrl !== null)?.thumbnailUrl;
      const eligibleForAttention = listing.availability === "active" ||
        listing.availability === "possibly_unavailable";
      if (eligibleForAttention && thumbnailUrl !== undefined && thumbnailUrl !== null) {
        try {
          imageDifferenceHash = (await this.#thumbnails.cache(listing.id, thumbnailUrl)).imageDifferenceHash;
        } catch (error: unknown) {
          this.#logger.warn("Thumbnail fingerprint unavailable", {
            listingId: listing.id,
            errorType: error instanceof Error ? error.name : "unknown"
          });
        }
      }
      const vehicle = createVehicleDuplicateFingerprint(enrichment);
      database.duplicates.saveFingerprint(
        listing.id,
        textTokens,
        vehicle,
        imageDifferenceHash,
        computedAt
      );
      if (eligibleForAttention) {
        candidates.push({
          listingId: listing.id,
          textTokens,
          vehicle,
          imageDifferenceHash,
          hasDescription: facts.original.description?.trim() !== "" &&
            facts.original.description != null,
          priceCents: enrichment.price.interpretation === "full_price"
            ? enrichment.price.amountCents
            : null
        });
      }
    }
    return database.duplicates.replaceGroups(groupProbableDuplicates(candidates), computedAt);
  }
}

function resolveEnrichment(
  stored: StoredEnrichment,
  facts: NormalizedVehicleFacts,
  corrected: ReadonlySet<NormalizedFactField>,
  structured: import("@dealfinder/domain").StructuredVehicleFacts | undefined
): VehicleEnrichment {
  return applyAuthoritativeStructuredFacts(stored.enrichment, facts, structured, corrected);
}

function validateTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Computed at must be an ISO timestamp");
}
