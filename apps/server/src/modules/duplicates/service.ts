import type { DatabaseConnection, StoredDuplicateGroup, StoredEnrichment } from "@dealfinder/db";
import {
  applyFactCorrections,
  createDuplicateTextTokens,
  createVehicleDuplicateFingerprint,
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
    if (database.enrichmentProcessing.getControl().downstreamPaused) {
      return database.duplicates.listGroups();
    }

    const candidates: DuplicateCandidateFingerprint[] = [];
    for (const stored of database.enrichmentProcessing.listEnrichments()) {
      const listing = database.listings.get(stored.listingId);
      const normalized = database.normalizedVehicles.getFacts(stored.listingId);
      if (listing === undefined || normalized === undefined) continue;
      this.#thumbnails.syncRetention(listing.id, listing.inactiveAt);

      const corrections = database.corrections.listForListing(listing.id);
      const facts = applyFactCorrections(normalized.facts, corrections);
      const enrichment = resolveEnrichment(stored, facts, new Set(
        corrections.map(({ field }) => field)
      ));
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
        candidates.push({ listingId: listing.id, textTokens, vehicle, imageDifferenceHash });
      }
    }
    return database.duplicates.replaceGroups(groupProbableDuplicates(candidates), computedAt);
  }
}

function resolveEnrichment(
  stored: StoredEnrichment,
  facts: NormalizedVehicleFacts,
  corrected: ReadonlySet<NormalizedFactField>
): VehicleEnrichment {
  const choose = <T>(field: NormalizedFactField, ai: T | null, normalized: T | null): T | null =>
    corrected.has(field) ? normalized : (ai ?? normalized);
  return {
    ...stored.enrichment,
    vehicle: {
      make: choose("make", stored.enrichment.vehicle.make, facts.make),
      model: choose("model", stored.enrichment.vehicle.model, facts.model),
      variant: choose("variant", stored.enrichment.vehicle.variant, facts.variant),
      year: choose("year", stored.enrichment.vehicle.year, facts.year),
      mileageKm: choose("mileageKm", stored.enrichment.vehicle.mileageKm, facts.mileageKm),
      fuel: choose("fuel", stored.enrichment.vehicle.fuel, facts.fuel),
      transmission: choose("transmission", stored.enrichment.vehicle.transmission, facts.transmission),
      powerHp: choose("powerHp", stored.enrichment.vehicle.powerHp, facts.powerHp)
    }
  };
}

function validateTimestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Computed at must be an ISO timestamp");
}
