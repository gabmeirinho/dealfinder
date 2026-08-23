import { describe, expect, it } from "vitest";

import type { VehicleEnrichment, VehicleRiskAssessment } from "../index.js";
import { buildComparableCohort, calculateDealScore, type ComparableListingInput } from "./index.js";

const EVALUATED_AT = "2026-08-23T12:00:00.000Z";

describe("transparent deal scoring", () => {
  it("reports a cold start without claiming a market discount", () => {
    const result = calculateDealScore(scoreInput({ marketplaceHistory: [] }));

    expect(result.cohort).toMatchObject({
      marketDataStatus: "insufficient",
      marketDataLabel: "Insufficient market data",
      medianPriceCents: null,
      members: []
    });
    expect(result.score).toMatchObject({
      total: 60,
      confidence: "low",
      marketDataStatus: "insufficient",
      discountPercent: null,
      comparableCount: 0
    });
    expect(component(result, "price_position")).toMatchObject({
      points: 0,
      explanation: "Insufficient market data; no market discount is claimed"
    });
  });

  it("requires five reasonable comparables before claiming a discount", () => {
    const history = [20_000, 21_000, 22_000, 23_000].map((euros, index) =>
      comparable(index + 2, euros * 100)
    );
    const result = calculateDealScore(scoreInput({ marketplaceHistory: history }));

    expect(result.cohort.members).toHaveLength(4);
    expect(result.cohort.medianPriceCents).toBeNull();
    expect(result.score.discountPercent).toBeNull();
    expect(result.score.marketDataLabel).toBe("Insufficient market data");
  });

  it("removes price outliers before computing a stable median", () => {
    const prices = [20_000, 21_000, 22_000, 23_000, 24_000, 100_000];
    const result = calculateDealScore(scoreInput({
      marketplaceHistory: prices.map((euros, index) => comparable(index + 2, euros * 100))
    }));

    expect(result.cohort.candidateCount).toBe(6);
    expect(result.cohort.members.map(({ listingId }) => listingId)).toEqual([2, 3, 4, 5, 6]);
    expect(result.cohort.excludedOutlierListingIds).toEqual([7]);
    expect(result.cohort.medianPriceCents).toBe(2_200_000);
    expect(result.score.discountPercent).toBe(0);
    expect(result.score.confidence).toBe("medium");
  });

  it("accepts bounded near matches but rejects materially different vehicles", () => {
    const subject = enrichment();
    const history = [
      comparable(2, 20_000 * 100, { variant: null, year: 2018, mileageKm: 120_000 }),
      comparable(3, 21_000 * 100, { year: 2022, mileageKm: 40_000 }),
      comparable(4, 22_000 * 100, { year: 2023 }),
      comparable(5, 22_000 * 100, { mileageKm: 121_000 }),
      comparable(6, 22_000 * 100, { fuel: "petrol" }),
      comparable(7, 22_000 * 100, { variant: "Luxury" })
    ];

    expect(buildComparableCohort(1, subject, history).members.map(({ listingId }) => listingId))
      .toEqual([2, 3]);
  });

  it("explains soft preferences, freshness, and nationwide distance", () => {
    const result = calculateDealScore(scoreInput({
      softPreferences: [true, true, true, false, null].map((matched, index) => ({
        criterion: "sellerPreference" as const,
        matched,
        explanation: `preference ${index}`
      })),
      distance: {
        status: "not_applicable",
        approximateKilometres: null,
        withinConfiguredRadius: null,
        method: null,
        label: "Nationwide search · distance not used",
        reason: null,
        attribution: null
      },
      lastSeenAt: "2026-08-21T12:00:00.000Z"
    }));

    expect(component(result, "preferences")).toEqual({
      key: "preferences", points: 4,
      explanation: "3 soft preferences matched, 1 missed, 1 unknown"
    });
    expect(component(result, "freshness").points).toBe(7);
    expect(component(result, "distance")).toEqual({
      key: "distance", points: 5,
      explanation: "Nationwide search; distance is not used"
    });
  });

  it("makes suspicious bargains lower-confidence instead of automatic winners", () => {
    const marketplaceHistory = [20_000, 21_000, 22_000, 23_000, 24_000]
      .map((euros, index) => comparable(index + 2, euros * 100));
    const normal = calculateDealScore(scoreInput({ marketplaceHistory }));
    const suspicious = calculateDealScore(scoreInput({
      enrichment: enrichment({ priceCents: 50_000 }),
      marketplaceHistory,
      risk: {
        highRiskVerifyPrice: true,
        reasons: [{
          code: "suspiciously_low_price",
          label: "HIGH RISK / VERIFY PRICE",
          explanation: "Vehicle price is below EUR 1,000"
        }]
      }
    }));

    expect(suspicious.score.discountPercent).toBeGreaterThan(90);
    expect(component(suspicious, "risk").points).toBe(-30);
    expect(suspicious.score.confidence).toBe("low");
    expect(suspicious.score.total).toBeLessThan(normal.score.total);
    expect(suspicious.score.total).toBeLessThanOrEqual(59);
  });

  it("recomputes identically for identical inputs", () => {
    const input = scoreInput({
      marketplaceHistory: [20_000, 21_000, 22_000, 23_000, 24_000]
        .map((euros, index) => comparable(index + 2, euros * 100))
    });
    expect(calculateDealScore(input)).toEqual(calculateDealScore(input));
  });
});

function scoreInput(overrides: Partial<Parameters<typeof calculateDealScore>[0]> = {}) {
  return {
    listingId: 1,
    enrichment: enrichment(),
    risk: noRisk(),
    softPreferences: [],
    distance: null,
    lastSeenAt: "2026-08-23T11:00:00.000Z",
    evaluatedAt: EVALUATED_AT,
    marketplaceHistory: [],
    ...overrides
  };
}

function comparable(
  listingId: number,
  priceCents: number,
  vehicleOverrides: Partial<VehicleEnrichment["vehicle"]> = {}
): ComparableListingInput {
  return {
    listingId,
    enrichment: enrichment({ priceCents, vehicleOverrides }),
    highRiskVerifyPrice: false
  };
}

function enrichment(options: {
  priceCents?: number;
  vehicleOverrides?: Partial<VehicleEnrichment["vehicle"]>;
} = {}): VehicleEnrichment {
  return {
    schemaVersion: 1,
    vehicle: {
      make: "BMW", model: "320d", variant: "M Sport", year: 2020,
      mileageKm: 80_000, fuel: "diesel", transmission: "automatic", powerHp: 190,
      ...options.vehicleOverrides
    },
    price: { amountCents: options.priceCents ?? 2_200_000, interpretation: "full_price" },
    sellerType: "dealer",
    indicators: { financing: false, monthlyPayment: false, deposit: false, damaged: false, imported: false },
    uncertainties: []
  };
}

function noRisk(): VehicleRiskAssessment {
  return { highRiskVerifyPrice: false, reasons: [] };
}

function component(
  result: ReturnType<typeof calculateDealScore>,
  key: ReturnType<typeof calculateDealScore>["score"]["components"][number]["key"]
) {
  return result.score.components.find((candidate) => candidate.key === key)!;
}
