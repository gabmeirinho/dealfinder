import { describe, expect, it } from "vitest";
import type { VehicleEnrichment, VehicleRiskAssessment } from "../index.js";
import { buildComparableCohort, calculateDealScore, type ComparableListingInput } from "./index.js";

const EVALUATED_AT = "2026-08-23T12:00:00.000Z";
const history = (count = 5) => Array.from({ length: count }, (_, index) =>
  comparable(index + 2, (20_000 + index * 1_000) * 100));

describe("separate deal assessments", () => {
  it("does not fabricate a market estimate or fit score during cold start", () => {
    const result = calculateDealScore(scoreInput());
    expect(result.score).not.toHaveProperty("total");
    expect(result.score.marketValue).toMatchObject({
      status: "insufficient_data", medianPriceCents: null, askingPriceRange: null,
      discountPercent: null, position: null, comparableCount: 0
    });
    expect(result.score.personalFit).toMatchObject({ status: "no_preferences", percent: null });
    expect(result.score.confidence.level).toBe("low");
  });

  it("requires five distinct reasonable comparables", () => {
    expect(calculateDealScore(scoreInput({ marketplaceHistory: history(4) })).score.marketValue)
      .toMatchObject({ status: "insufficient_data", comparableCount: 4, discountPercent: null });
    const market = calculateDealScore(scoreInput({ marketplaceHistory: history() })).score.marketValue;
    expect(market).toMatchObject({
      status: "available", medianPriceCents: 2_200_000,
      askingPriceRange: { lowerCents: 2_100_000, upperCents: 2_300_000 },
      comparableCount: 5, discountPercent: 0, position: "within_range"
    });
  });

  it("removes price outliers before deriving the range and median", () => {
    const result = calculateDealScore(scoreInput({ marketplaceHistory: [...history(), comparable(7, 10_000_000)] }));
    expect(result.cohort.excludedOutlierListingIds).toEqual([7]);
    expect(result.score.marketValue.medianPriceCents).toBe(2_200_000);
    expect(result.score.confidence.level).toBe("medium");
  });

  it("rejects materially different vehicles from the cohort", () => {
    const values = [
      comparable(2, 2_000_000, { variant: null, year: 2018, mileageKm: 120_000 }),
      comparable(3, 2_100_000, { year: 2022, mileageKm: 40_000 }),
      comparable(4, 2_200_000, { year: 2023 }),
      comparable(5, 2_200_000, { mileageKm: 121_000 }),
      comparable(6, 2_200_000, { fuel: "petrol" }),
      comparable(7, 2_200_000, { variant: "Luxury" })
    ];
    expect(buildComparableCohort(1, enrichment(), values).members.map((member) => member.listingId)).toEqual([2, 3]);
  });

  it("keeps preferences and distance separate from market value and confidence", () => {
    const input = scoreInput({ marketplaceHistory: history() });
    const original = calculateDealScore(input).score;
    const changed = calculateDealScore({ ...input,
      softPreferences: [true, true, false, null].map((matched) => ({
        criterion: "sellerPreference", matched, explanation: "Seller preference"
      })),
      distance: { status: "not_applicable", approximateKilometres: null, withinConfiguredRadius: null,
        method: null, label: "Nationwide search · distance not used", reason: null, attribution: null }
    }).score;
    expect(changed.marketValue).toEqual(original.marketValue);
    expect(changed.confidence).toEqual(original.confidence);
    expect(changed.personalFit).toMatchObject({ status: "partial", percent: 67, matchedCount: 2, missedCount: 1, unknownCount: 1 });
    expect(changed.personalFit.distance?.label).toContain("Nationwide");
  });

  it("keeps all-unknown preferences unscored and all-known failures at zero fit", () => {
    const preference = { criterion: "sellerPreference" as const, explanation: "Unknown seller", matched: null };
    expect(calculateDealScore(scoreInput({ softPreferences: [preference] })).score.personalFit)
      .toMatchObject({ status: "needs_information", percent: null });
    expect(calculateDealScore(scoreInput({ softPreferences: [{ ...preference, matched: false }] })).score.personalFit)
      .toMatchObject({ status: "assessed", percent: 0 });
  });

  it("does not convert perfect personal fit into market evidence", () => {
    const score = calculateDealScore(scoreInput({
      softPreferences: [{ criterion: "sellerPreference", matched: true, explanation: "Dealer preferred" }]
    })).score;
    expect(score.personalFit.percent).toBe(100);
    expect(score.marketValue.status).toBe("insufficient_data");
    expect(score.confidence.level).toBe("low");
  });

  it.each([50_000, 900_000])("withholds bargain claims for suspicious prices (%s cents)", (priceCents) => {
    const score = calculateDealScore(scoreInput({
      marketplaceHistory: history(), enrichment: enrichment({ priceCents })
    })).score;
    expect(score.marketValue).toMatchObject({ status: "verify_price", discountPercent: null, position: null });
    expect(score.confidence.level).toBe("low");
  });

  it("withholds price comparisons for financing and explicit risk flags", () => {
    const value = enrichment();
    value.price.interpretation = "monthly_payment";
    expect(calculateDealScore(scoreInput({ marketplaceHistory: history(), enrichment: value })).score.marketValue.status)
      .toBe("verify_price");
    expect(calculateDealScore(scoreInput({ marketplaceHistory: history(), risk: { highRiskVerifyPrice: true, reasons: [] } }))
      .score.confidence.level).toBe("low");
  });

  it("requires recent narrow evidence for high confidence", () => {
    const recent = Array.from({ length: 10 }, (_, index) => comparable(index + 2, 2_100_000 + index * 10_000));
    expect(calculateDealScore(scoreInput({ marketplaceHistory: recent })).score.confidence.level).toBe("high");
    const dated = recent.map((item) => ({ ...item, lastSeenAt: "2026-07-01T00:00:00.000Z" }));
    expect(calculateDealScore(scoreInput({ marketplaceHistory: dated })).score.confidence.level).toBe("medium");
    const broad = recent.map((item, index) => ({ ...item, enrichment: enrichment({ priceCents: (10_000 + index * 10_000) * 100 }) }));
    expect(calculateDealScore(scoreInput({ marketplaceHistory: broad, enrichment: enrichment({ priceCents: 5_500_000 }) }))
      .score.confidence.level).toBe("low");
  });

  it("caps confidence when variants, extraction, or captured facts are uncertain", () => {
    const recent = Array.from({ length: 10 }, (_, index) => comparable(index + 2, 2_100_000 + index * 10_000));
    const input = scoreInput({ marketplaceHistory: recent });
    expect(calculateDealScore({ ...input, enrichment: enrichment({ vehicleOverrides: { variant: null } }) })
      .score.confidence.level).toBe("medium");
    expect(calculateDealScore({ ...input, factConflicts: ["mileageKm"] }).score.confidence.level).toBe("low");
  });

  it("does not count relistings, repeated IDs, or the subject's own duplicate", () => {
    const values = [
      { ...comparable(1, 2_200_000), duplicateGroupId: "subject" },
      { ...comparable(2, 2_200_000), duplicateGroupId: "subject" },
      { ...comparable(3, 2_200_000), duplicateGroupId: "other", lastSeenAt: "2026-08-20T00:00:00.000Z" },
      { ...comparable(4, 2_200_000), duplicateGroupId: "other" },
      comparable(5, 2_200_000), comparable(5, 2_200_000)
    ];
    const result = calculateDealScore(scoreInput({ marketplaceHistory: values }));
    expect(result.cohort.members.map((member) => member.listingId)).toEqual([4, 5]);
    expect(result.score.marketValue.comparableCount).toBe(2);
  });

  it("excludes observations older than 90 days and future timestamps", () => {
    const values = history().map((item, index) => ({ ...item,
      lastSeenAt: index === 0 ? "2026-01-01T00:00:00.000Z" : index === 1 ? "2027-01-01T00:00:00.000Z" : EVALUATED_AT
    }));
    expect(calculateDealScore(scoreInput({ marketplaceHistory: values })).score.marketValue.comparableCount).toBe(3);
  });

  it("recomputes identically for identical evidence", () => {
    const input = scoreInput({ marketplaceHistory: history() });
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
    highRiskVerifyPrice: false,
    lastSeenAt: EVALUATED_AT
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
