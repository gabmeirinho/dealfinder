import type { DatabaseConnection, StoredDealScore, StoredEnrichment } from "@dealfinder/db";
import {
  applyAuthoritativeStructuredFacts,
  applyFactCorrections,
  assessVehicleRisk,
  calculateDealScore,
  evaluateVehicleMatch,
  type ComparableListingInput,
  type NormalizedFactField,
  type NormalizedVehicleFacts,
  type StructuredVehicleFacts,
  type VehicleEnrichment,
  type VehicleRiskAssessment
} from "@dealfinder/domain";

export interface DealScoringServiceOptions {
  database: () => DatabaseConnection;
}

interface ResolvedListing {
  listingId: number;
  enrichment: VehicleEnrichment;
  facts: NormalizedVehicleFacts;
  risk: VehicleRiskAssessment;
}

export class DealScoringService {
  readonly #database: () => DatabaseConnection;

  public constructor(options: DealScoringServiceOptions) {
    this.#database = options.database;
  }

  public recomputeAll(scoredAt: string): StoredDealScore[] {
    validateTimestamp(scoredAt, "Scored at");
    const database = this.#database();
    if (database.enrichmentProcessing.getControl().downstreamPaused) return [];
    const resolved = database.enrichmentProcessing.listEnrichments()
      .map((stored) => resolveListing(database, stored))
      .filter((listing): listing is ResolvedListing => listing !== undefined);
    const history: ComparableListingInput[] = resolved.map((listing) => ({
      listingId: listing.listingId,
      enrichment: listing.enrichment,
      highRiskVerifyPrice: listing.risk.highRiskVerifyPrice
    }));
    return resolved.flatMap((subject) => this.recomputeSubject(subject, history, scoredAt));
  }

  public recomputeListing(listingId: number, scoredAt: string): StoredDealScore[] {
    validateTimestamp(scoredAt, "Scored at");
    const database = this.#database();
    if (database.enrichmentProcessing.getControl().downstreamPaused) return [];
    const resolved = database.enrichmentProcessing.listEnrichments()
      .map((stored) => resolveListing(database, stored))
      .filter((listing): listing is ResolvedListing => listing !== undefined);
    const subject = resolved.find((listing) => listing.listingId === listingId);
    if (subject === undefined) return [];
    const history = resolved.map((listing) => ({
      listingId: listing.listingId,
      enrichment: listing.enrichment,
      highRiskVerifyPrice: listing.risk.highRiskVerifyPrice
    }));
    return this.recomputeSubject(subject, history, scoredAt);
  }

  private recomputeSubject(
    subject: ResolvedListing,
    history: readonly ComparableListingInput[],
    scoredAt: string
  ): StoredDealScore[] {
    const database = this.#database();
    const listing = database.listings.get(subject.listingId);
    if (listing === undefined) return [];
    if (listing.availability === "inactive" || listing.availability === "sold") {
      for (const searchId of database.listings.listSearchIds(subject.listingId)) {
        database.dealScores.delete(subject.listingId, searchId);
      }
      return [];
    }
    database.normalizedVehicles.saveRisk(subject.listingId, subject.risk, scoredAt);
    const scores: StoredDealScore[] = [];
    for (const searchId of database.listings.listSearchIds(subject.listingId)) {
      const search = database.searches.get(searchId);
      if (search === undefined) continue;
      const match = evaluateVehicleMatch(subject.facts, search.criteria);
      database.normalizedVehicles.saveMatch(subject.listingId, searchId, match, scoredAt);
      if (!match.eligible) {
        database.dealScores.delete(subject.listingId, searchId);
        continue;
      }
      const calculation = calculateDealScore({
        listingId: subject.listingId,
        enrichment: subject.enrichment,
        risk: subject.risk,
        softPreferences: match.softContributions,
        distance: database.geocoding.getDistance(subject.listingId, searchId)?.distance ?? null,
        lastSeenAt: listing.lastSeenAt,
        evaluatedAt: scoredAt,
        marketplaceHistory: history
      });
      scores.push(database.dealScores.save(subject.listingId, searchId, calculation, scoredAt));
    }
    return scores;
  }
}

function resolveListing(
  database: DatabaseConnection,
  stored: StoredEnrichment
): ResolvedListing | undefined {
  const normalized = database.normalizedVehicles.getFacts(stored.listingId);
  if (normalized === undefined) return undefined;
  // A capture or scan can update facts while another listing finishes enrichment.
  // Do not let that global rescore revive an older interpretation of this listing.
  if (stored.sourceNormalizedAt < normalized.normalizedAt) {
    for (const searchId of database.listings.listSearchIds(stored.listingId)) {
      database.dealScores.delete(stored.listingId, searchId);
    }
    return undefined;
  }
  const corrections = database.corrections.listForListing(stored.listingId);
  const corrected = new Set<NormalizedFactField>(corrections.map(({ field }) => field));
  const effective = applyFactCorrections(normalized.facts, corrections);
  const enrichment = resolveEnrichment(
    stored.enrichment,
    effective,
    corrected,
    database.listingDetailFacts.get(stored.listingId)?.structuredFacts
  );
  const facts: NormalizedVehicleFacts = {
    ...effective,
    priceCents: enrichment.price.interpretation === "full_price"
      ? enrichment.price.amountCents
      : effective.priceCents,
    year: enrichment.vehicle.year,
    mileageKm: enrichment.vehicle.mileageKm,
    make: enrichment.vehicle.make,
    model: enrichment.vehicle.model,
    variant: enrichment.vehicle.variant,
    fuel: enrichment.vehicle.fuel,
    transmission: enrichment.vehicle.transmission,
    powerHp: enrichment.vehicle.powerHp,
    seller: { ...effective.seller, type: enrichment.sellerType },
    indicators: { ...enrichment.indicators }
  };
  return {
    listingId: stored.listingId,
    enrichment,
    facts,
    risk: assessVehicleRisk(facts)
  };
}

function resolveEnrichment(
  enrichment: VehicleEnrichment,
  facts: NormalizedVehicleFacts,
  corrected: ReadonlySet<NormalizedFactField>,
  structured: StructuredVehicleFacts | undefined
): VehicleEnrichment {
  const choose = <T>(field: NormalizedFactField, ai: T | null, normalized: T | null): T | null =>
    corrected.has(field) ? normalized : (ai ?? normalized);
  const priceCorrected = corrected.has("priceCents");
  const sourceAware = applyAuthoritativeStructuredFacts(enrichment, facts, structured, corrected);
  return {
    ...sourceAware,
    vehicle: {
      ...sourceAware.vehicle
    },
    price: priceCorrected
      ? { amountCents: facts.priceCents, interpretation: facts.priceCents === null ? "unknown" : "full_price" }
      : enrichment.price,
    sellerType: choose("sellerType", enrichment.sellerType, facts.seller.type),
    indicators: {
      financing: enrichment.indicators.financing || facts.indicators.financing,
      monthlyPayment: enrichment.indicators.monthlyPayment || facts.indicators.monthlyPayment,
      deposit: enrichment.indicators.deposit || facts.indicators.deposit,
      damaged: enrichment.indicators.damaged || facts.indicators.damaged,
      imported: enrichment.indicators.imported || facts.indicators.imported
    }
  };
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}
