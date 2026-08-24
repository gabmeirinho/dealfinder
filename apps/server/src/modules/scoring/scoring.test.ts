import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft, type VehicleEnrichment } from "@dealfinder/domain";

import { CorrectionsService } from "../corrections/index.js";
import { ListingIngestionService } from "../listings/index.js";
import { DealScoringService } from "./service.js";

const SCORED_AT = "2026-08-23T12:00:00.000Z";

describe("deal scoring service", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("persists explainable components from enriched history, preferences, freshness, and distance", () => {
    const setup = seed([22_000, 20_000, 21_000, 22_000, 23_000, 24_000, 100_000], true);
    database = setup.database;
    database.geocoding.saveDistance(
      setup.listingIds[0]!, setup.searchId, null, null,
      {
        status: "not_applicable",
        approximateKilometres: null,
        withinConfiguredRadius: null,
        method: null,
        label: "Nationwide search · distance not used",
        reason: null,
        attribution: null
      },
      SCORED_AT
    );
    const scores = new DealScoringService({ database: () => setup.database }).recomputeAll(SCORED_AT);
    const subject = scores.find(({ listingId }) => listingId === setup.listingIds[0])!;

    expect(subject.cohort).toMatchObject({
      candidateCount: 6,
      medianPriceCents: 2_200_000,
      marketDataStatus: "sufficient",
      excludedOutlierListingIds: [setup.listingIds[6]]
    });
    expect(subject.cohort.members).toHaveLength(5);
    expect(subject.score).toMatchObject({
      total: 62,
      confidence: "medium",
      discountPercent: 0,
      comparableCount: 5,
      marketDataLabel: "Market data available"
    });
    expect(subject.score.components.map(({ key }) => key)).toEqual([
      "price_position", "preferences", "freshness", "distance", "data_completeness", "risk"
    ]);
    expect(subject.score.components.find(({ key }) => key === "distance")?.explanation)
      .toBe("Nationwide search; distance is not used");
  });

  it("stores insufficient market data during cold start and recomputes stably", () => {
    const setup = seed([22_000]);
    database = setup.database;
    const service = new DealScoringService({ database: () => setup.database });

    const first = service.recomputeAll(SCORED_AT);
    const second = service.recomputeAll(SCORED_AT);

    expect(first).toEqual(second);
    expect(first[0]?.score).toMatchObject({
      confidence: "low",
      marketDataStatus: "insufficient",
      marketDataLabel: "Insufficient market data",
      medianPriceCents: null,
      discountPercent: null
    });
  });

  it("keeps suspicious bargains low-confidence and below the winner threshold", () => {
    const setup = seed([500, 20_000, 21_000, 22_000, 23_000, 24_000]);
    database = setup.database;
    const score = new DealScoringService({ database: () => setup.database })
      .recomputeListing(setup.listingIds[0]!, SCORED_AT)[0]!;

    expect(score.score.discountPercent).toBeGreaterThan(90);
    expect(score.score.confidence).toBe("low");
    expect(score.score.total).toBeLessThanOrEqual(59);
    expect(score.score.components.find(({ key }) => key === "risk")).toMatchObject({ points: -30 });
  });

  it("lets human corrections override AI facts and remove an ineligible score", () => {
    const setup = seed([22_000]);
    database = setup.database;
    const scoring = new DealScoringService({ database: () => setup.database });
    scoring.recomputeAll(SCORED_AT);
    expect(database.dealScores.get(setup.listingIds[0]!, setup.searchId)).toBeDefined();

    new CorrectionsService(() => setup.database).correct({
      listingId: setup.listingIds[0]!,
      field: "make",
      value: "Ford",
      correctedAt: "2026-08-23T12:05:00.000Z"
    });
    expect(database.dealScores.get(setup.listingIds[0]!, setup.searchId)).toBeUndefined();
    scoring.recomputeAll("2026-08-23T12:05:00.000Z");

    expect(database.dealScores.get(setup.listingIds[0]!, setup.searchId)).toBeUndefined();
    expect(database.normalizedVehicles.getMatch(setup.listingIds[0]!, setup.searchId)?.eligible).toBe(false);
  });

  it("does not recompute downstream scores while credit processing is paused", () => {
    const setup = seed([22_000]);
    database = setup.database;
    database.database.prepare(`
      UPDATE processing_control SET state = 'credit_paused', paused_at = ? WHERE singleton_id = 1
    `).run(SCORED_AT);

    expect(new DealScoringService({ database: () => setup.database }).recomputeAll(SCORED_AT)).toEqual([]);
    expect(database.dealScores.listRanked(setup.searchId)).toEqual([]);
  });
});

function seed(pricesEur: number[], nationwide = false) {
  const database = openDatabase({ filename: ":memory:" });
  const draft = createVehicleSearchDraft("BMW deals");
  draft.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
  draft.criteria.sellerPreference = { value: "dealer", strength: "soft" };
  if (nationwide) draft.location = { mode: "nationwide", origin: null, radiusKm: null };
  const search = database.searches.create(draft);
  const ingestion = new ListingIngestionService(() => database);
  const listingIds = pricesEur.map((priceEur, index) => {
    const sourceListingId = String(100000000000001 + index);
    return ingestion.ingestScan({
      searchId: search.id,
      observedAt: new Date(Date.parse("2026-08-23T10:00:00.000Z") + index * 1000).toISOString(),
      initialScan: false,
      completeSnapshot: false,
      candidates: [{
        source: "facebook",
        sourceListingId,
        url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
        title: "BMW 320d M Sport 2020",
        description: "80 000 km, diesel, automática, 190 cv, dealer",
        displayedPrice: `${priceEur} €`,
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: ["80 000 km"],
        seller: { type: "dealer" }
      }]
    }).listings[0]!.id;
  });
  const pricesByListing = new Map(listingIds.map((listingId, index) => [listingId, pricesEur[index]! * 100]));
  while (true) {
    const claim = database.enrichmentProcessing.claimNext(SCORED_AT);
    if (claim === undefined) break;
    database.enrichmentProcessing.completeSuccess(
      claim,
      enrichment(pricesByListing.get(claim.listingId)!),
      SCORED_AT,
      null
    );
  }
  return { database, searchId: search.id, listingIds };
}

function enrichment(priceCents: number): VehicleEnrichment {
  return {
    schemaVersion: 1,
    vehicle: {
      make: "BMW", model: "320d", variant: "M Sport", year: 2020,
      mileageKm: 80_000, fuel: "diesel", transmission: "automatic", powerHp: 190
    },
    price: { amountCents: priceCents, interpretation: "full_price" },
    sellerType: "dealer",
    indicators: { financing: false, monthlyPayment: false, deposit: false, damaged: false, imported: false },
    uncertainties: []
  };
}
