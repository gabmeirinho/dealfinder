import type { DatabaseConnection, Listing, ListingEvent } from "@dealfinder/db";

export interface RawListingObservation {
  source: "facebook";
  sourceListingId: string;
  url: string;
  title: string;
  displayedPrice: string | null;
  location: string | null;
  thumbnailUrl: string | null;
  rawCardFacts: readonly string[];
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
          priceCents: parseDisplayedEuroPrice(candidate.displayedPrice),
          ...(candidate.explicitlySold === undefined
            ? {}
            : { explicitlySold: candidate.explicitlySold })
        });
        listings.push(ingested.listing);
        observedListingIds.add(ingested.listing.id);
        if (ingested.created) listingsCreated += 1;
        if (ingested.priceChanged) priceChanges += 1;
        if (ingested.event !== null) events.push(ingested.event);
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

/** Conservative card-price parsing; richer normalization belongs to P4-C2. */
export function parseDisplayedEuroPrice(displayedPrice: string | null): number | null {
  if (displayedPrice === null) return null;
  const normalized = displayedPrice.normalize("NFKC").trim();
  if (/^(?:free|gr[aá]tis|gratuito)$/iu.test(normalized)) return 0;
  if (!normalized.includes("€")) return null;
  const numeric = normalized.replace(/[^\d.,]/gu, "");
  if (numeric === "") return null;

  const separator = Math.max(numeric.lastIndexOf(","), numeric.lastIndexOf("."));
  const decimalDigits = separator < 0 ? 0 : numeric.length - separator - 1;
  const hasCents = decimalDigits === 2;
  const eurosText = (hasCents ? numeric.slice(0, separator) : numeric).replace(/[^\d]/gu, "");
  const centsText = hasCents ? numeric.slice(separator + 1) : "00";
  if (eurosText === "") return null;
  const cents = Number(eurosText) * 100 + Number(centsText);
  return Number.isSafeInteger(cents) ? cents : null;
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
