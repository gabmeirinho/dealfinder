import type { DatabaseConnection, StoredDealScore, StoredEnrichment } from "@dealfinder/db";
import {
  applyFactCorrections,
  assessVehicleRisk,
  calculateDealScore,
  evaluateVehicleMatch,
  type ComparableListingInput,
  type NormalizedFactField,
  type NormalizedVehicleFacts,
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
  const corrections = database.corrections.listForListing(stored.listingId);
  const corrected = new Set<NormalizedFactField>(corrections.map(({ field }) => field));
  const effective = applyFactCorrections(normalized.facts, corrections);
  const enrichment = resolveEnrichment(stored.enrichment, effective, corrected);
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
  corrected: ReadonlySet<NormalizedFactField>
): VehicleEnrichment {
  const choose = <T>(field: NormalizedFactField, ai: T | null, normalized: T | null): T | null =>
    corrected.has(field) ? normalized : (ai ?? normalized);
  const priceCorrected = corrected.has("priceCents");
  return {
    ...enrichment,
    vehicle: {
      make: choose("make", enrichment.vehicle.make, facts.make),
      model: choose("model", enrichment.vehicle.model, facts.model),
      variant: choose("variant", enrichment.vehicle.variant, facts.variant),
      year: choose("year", enrichment.vehicle.year, facts.year),
      mileageKm: choose("mileageKm", enrichment.vehicle.mileageKm, facts.mileageKm),
      fuel: choose("fuel", enrichment.vehicle.fuel, facts.fuel),
      transmission: choose("transmission", enrichment.vehicle.transmission, facts.transmission),
      powerHp: choose("powerHp", enrichment.vehicle.powerHp, facts.powerHp)
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
