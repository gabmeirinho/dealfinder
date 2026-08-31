import type { DatabaseConnection, Listing, ListingEvent } from "@dealfinder/db";
import {
  applyFactCorrections,
  applyReusableRules,
  assessVehicleRisk,
  classifyListing,
  evaluateVehicleMatch,
  normalizeEuroPrice,
  normalizeVehicleFacts,
  type CoarseSellerSignals
} from "@dealfinder/domain";

export interface RawListingObservation {
  source: "facebook";
  sourceListingId: string;
  url: string;
  title: string;
  description?: string | null;
  displayedPrice: string | null;
  location: string | null;
  thumbnailUrl: string | null;
  rawCardFacts: readonly string[];
  seller?: Partial<CoarseSellerSignals>;
  explicitlySold?: boolean;
}

export interface IngestListingScan {
  searchId: string;
  observedAt: string;
  initialScan: boolean;
  completeSnapshot: boolean;
  candidates: readonly RawListingObservation[];
}

export interface ListingScanIngestionResult {
  replayed: boolean;
  observationsInserted: number;
  listingsCreated: number;
  priceChanges: number;
  missedListings: number;
  listings: readonly Listing[];
  events: readonly ListingEvent[];
}

export class ListingIngestionService {
  public constructor(private readonly database: () => DatabaseConnection) {}

  public ingestScan(input: IngestListingScan): ListingScanIngestionResult {
    const database = this.database();
    return database.transaction(() => {
      const claimed = database.listings.claimScan(
        input.searchId,
        input.observedAt,
        input.initialScan,
        input.completeSnapshot
      );
      if (!claimed) return replayedResult();

      const listings: Listing[] = [];
      const events: ListingEvent[] = [];
      const observedListingIds = new Set<number>();
      const approvedRules = database.corrections.listApprovedRules();
      const search = database.searches.get(input.searchId);
      if (search === undefined) throw new Error(`Search not found during normalization: ${input.searchId}`);
      let observationsInserted = 0;
      let listingsCreated = 0;
      let priceChanges = 0;

      for (const candidate of input.candidates) {
        const raw = database.rawCandidates.saveObservation({
          searchId: input.searchId,
          observedAt: input.observedAt,
          candidate
        });
        if (raw.inserted) observationsInserted += 1;
        const ingested = database.listings.ingestObservation({
          rawCandidateId: raw.candidate.id,
          searchId: input.searchId,
          observedAt: input.observedAt,
          initialScan: input.initialScan,
          source: candidate.source,
          sourceListingId: candidate.sourceListingId,
          listingUrl: candidate.url,
          title: candidate.title,
          displayedPrice: candidate.displayedPrice,
          priceCents: normalizeEuroPrice(candidate.displayedPrice),
          ...(candidate.explicitlySold === undefined
            ? {}
            : { explicitlySold: candidate.explicitlySold })
        });
        listings.push(ingested.listing);
        observedListingIds.add(ingested.listing.id);
        if (ingested.created) listingsCreated += 1;
        if (ingested.priceChanged) priceChanges += 1;
        if (ingested.event !== null) events.push(ingested.event);

        const classification = classifyListing({ title: candidate.title });
        database.listingClassifications.save(
          ingested.listing.id,
          classification,
          input.observedAt
        );
        if (classification.decision === "exclude") continue;

        const normalized = applyReusableRules(normalizeVehicleFacts({
          title: candidate.title,
          description: candidate.description ?? null,
          displayedPrice: candidate.displayedPrice,
          cardFacts: candidate.rawCardFacts,
          referenceYear: new Date(input.observedAt).getUTCFullYear(),
          ...(candidate.seller === undefined ? {} : { seller: candidate.seller })
        }), approvedRules);
        database.normalizedVehicles.saveFacts(
          ingested.listing.id,
          raw.observation.id,
          normalized,
          input.observedAt
        );
        const effective = applyFactCorrections(
          normalized,
          database.corrections.listForListing(ingested.listing.id)
        );
        database.normalizedVehicles.saveRisk(
          ingested.listing.id,
          assessVehicleRisk(effective),
          input.observedAt
        );
        const match = evaluateVehicleMatch(effective, search.criteria);
        database.normalizedVehicles.saveMatch(
          ingested.listing.id,
          input.searchId,
          match,
          input.observedAt
        );
        if (match.eligible) {
          database.enrichmentProcessing.enqueue(ingested.listing.id, input.observedAt);
        }
      }

      const missed = input.completeSnapshot
        ? database.listings.recordMisses(input.searchId, observedListingIds, input.observedAt)
        : [];

      return {
        replayed: false,
        observationsInserted,
        listingsCreated,
        priceChanges,
        missedListings: missed.length,
        listings,
        events
      };
    });
  }

  public expireInactive(evaluatedAt: string): Listing[] {
    const database = this.database();
    return database.transaction(() => database.listings.expireInactive(evaluatedAt));
  }
}

/** Backwards-compatible entry point retained for the listing-lifecycle module. */
export function parseDisplayedEuroPrice(displayedPrice: string | null): number | null {
  return normalizeEuroPrice(displayedPrice);
}

function replayedResult(): ListingScanIngestionResult {
  return {
    replayed: true,
    observationsInserted: 0,
    listingsCreated: 0,
    priceChanges: 0,
    missedListings: 0,
    listings: [],
    events: []
  };
}
