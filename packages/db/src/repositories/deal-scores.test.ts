import { afterEach, describe, expect, it } from "vitest";

import {
  calculateDealScore,
  createVehicleSearchDraft,
  type ComparableListingInput,
  type VehicleEnrichment
} from "@dealfinder/domain";

import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

const AT = "2026-08-23T12:00:00.000Z";

describe("deal scores repository", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(() => testDatabase?.cleanup());

  it("atomically stores the score, explanations, cohort members, and outlier IDs", () => {
    testDatabase = createTestDatabase();
    const setup = createListings(testDatabase, 7);
    const history = setup.listingIds.slice(1).map((listingId, index) =>
      comparable(listingId, [20_000, 21_000, 22_000, 23_000, 24_000, 100_000][index]! * 100)
    );
    const calculation = calculateDealScore({
      listingId: setup.listingIds[0]!,
      enrichment: enrichment(2_200_000),
      risk: { highRiskVerifyPrice: false, reasons: [] },
      softPreferences: [],
      distance: null,
      lastSeenAt: "2026-08-23T11:00:00.000Z",
      evaluatedAt: AT,
      marketplaceHistory: history
    });

    const stored = testDatabase.connection.dealScores.save(
      setup.listingIds[0]!, setup.searchId, calculation, AT
    );

    expect(stored).toEqual({
      listingId: setup.listingIds[0],
      searchId: setup.searchId,
      scoredAt: AT,
      ...calculation
    });
    expect(stored.cohort.excludedOutlierListingIds).toEqual([setup.listingIds[6]]);
    expect(stored.score.components).toHaveLength(6);
  });

  it("replaces prior recomputation instead of accumulating stale membership", () => {
    testDatabase = createTestDatabase();
    const setup = createListings(testDatabase, 7);
    const subject = setup.listingIds[0]!;
    const calculate = (count: number) => calculateDealScore({
      listingId: subject,
      enrichment: enrichment(2_200_000),
      risk: { highRiskVerifyPrice: false, reasons: [] },
      softPreferences: [],
      distance: null,
      lastSeenAt: AT,
      evaluatedAt: AT,
      marketplaceHistory: setup.listingIds.slice(1, count + 1)
        .map((listingId, index) => comparable(listingId, (20_000 + index * 1_000) * 100))
    });
    testDatabase.connection.dealScores.save(subject, setup.searchId, calculate(6), AT);
    const later = "2026-08-23T12:05:00.000Z";
    testDatabase.connection.dealScores.save(subject, setup.searchId, calculate(4), later);

    const stored = testDatabase.connection.dealScores.get(subject, setup.searchId);
    expect(stored).toMatchObject({
      scoredAt: later,
      cohort: { marketDataStatus: "insufficient" },
      score: { comparableCount: 4, discountPercent: null }
    });
    expect(stored?.cohort.members).toHaveLength(4);
    expect(testDatabase.connection.database.prepare(`
      SELECT count(*) AS count FROM comparable_cohort_members
      WHERE subject_listing_id = ? AND search_id = ?
    `).get(subject, setup.searchId)).toEqual({ count: 4 });
  });

  it("lists scores in deterministic descending order", () => {
    testDatabase = createTestDatabase();
    const setup = createListings(testDatabase, 2);
    for (const [index, listingId] of setup.listingIds.entries()) {
      const calculation = calculateDealScore({
        listingId,
        enrichment: enrichment(2_200_000),
        risk: { highRiskVerifyPrice: false, reasons: [] },
        softPreferences: index === 0 ? [] : [{
          criterion: "sellerPreference", matched: true, explanation: "dealer preferred"
        }],
        distance: null,
        lastSeenAt: AT,
        evaluatedAt: AT,
        marketplaceHistory: []
      });
      testDatabase.connection.dealScores.save(listingId, setup.searchId, calculation, AT);
    }

    expect(testDatabase.connection.dealScores.listRanked(setup.searchId).map(({ listingId }) => listingId))
      .toEqual([setup.listingIds[1], setup.listingIds[0]]);
  });
});

function createListings(testDatabase: TestDatabase, count: number) {
  const database = testDatabase.connection;
  const draft = createVehicleSearchDraft("BMW scores");
  draft.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
  const search = database.searches.create(draft);
  const listingIds = Array.from({ length: count }, (_, index) => {
    const sourceListingId = String(100000000000001 + index);
    const raw = database.rawCandidates.saveObservation({
      searchId: search.id,
      observedAt: new Date(Date.parse(AT) + index * 1000).toISOString(),
      candidate: {
        source: "facebook",
        sourceListingId,
        url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
        title: "BMW 320d 2020",
        displayedPrice: "22 000 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: ["80 000 km"]
      }
    });
    return database.listings.ingestObservation({
      rawCandidateId: raw.candidate.id,
      searchId: search.id,
      observedAt: raw.observation.observedAt,
      initialScan: false,
      source: "facebook",
      sourceListingId,
      listingUrl: raw.candidate.listingUrl,
      title: raw.observation.title,
      displayedPrice: raw.observation.displayedPrice,
      priceCents: 2_200_000
    }).listing.id;
  });
  return { searchId: search.id, listingIds };
}

function comparable(listingId: number, priceCents: number): ComparableListingInput {
  return { listingId, enrichment: enrichment(priceCents), highRiskVerifyPrice: false };
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
