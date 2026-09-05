import { buildComparableCohort, percentile } from "./cohort.js";
import {
  DEAL_SCORE_VERSION,
  type CalculateDealScoreInput,
  type ComparableCohort,
  type DealScoreCalculation,
  type MarketValueAssessment,
  type PersonalFitAssessment,
  type ValuationConfidence
} from "./types.js";

export function calculateDealScore(input: CalculateDealScoreInput): DealScoreCalculation {
  validateTimestamp(input.lastSeenAt, "Last seen at");
  validateTimestamp(input.evaluatedAt, "Evaluated at");
  const cohort = buildComparableCohort(input.listingId, input.enrichment, input.marketplaceHistory, input.evaluatedAt);
  const marketValue = assessMarketValue(input, cohort);
  return {
    cohort,
    score: {
      version: DEAL_SCORE_VERSION,
      marketValue,
      personalFit: assessPersonalFit(input),
      confidence: assessConfidence(input, cohort, marketValue)
    }
  };
}

function assessMarketValue(input: CalculateDealScoreInput, cohort: ComparableCohort): MarketValueAssessment {
  const medianPriceCents = cohort.medianPriceCents;
  const prices = cohort.members.map((member) => member.priceCents).sort((a, b) => a - b);
  const askingPriceRange = medianPriceCents === null ? null : {
    lowerCents: Math.round(percentile(prices, 0.25)),
    upperCents: Math.round(percentile(prices, 0.75))
  };
  const price = input.enrichment.price;
  const verifyPrice = input.risk.highRiskVerifyPrice || price.interpretation !== "full_price" ||
    price.amountCents === null || price.amountCents <= 0 ||
    (medianPriceCents !== null && price.amountCents < medianPriceCents * 0.5);
  const base = { medianPriceCents, askingPriceRange, comparableCount: prices.length };
  if (verifyPrice) return {
    ...base, status: "verify_price", discountPercent: null, position: null,
    explanation: "Verify the full asking price and vehicle condition before treating this as a bargain."
  };
  if (medianPriceCents === null || askingPriceRange === null) return {
    ...base, status: "insufficient_data", discountPercent: null, position: null,
    explanation: `Insufficient market data: ${prices.length} comparable vehicles; at least 5 are required.`
  };
  const amount = price.amountCents as number;
  return {
    ...base, status: "available",
    discountPercent: roundOne((medianPriceCents - amount) / medianPriceCents * 100),
    position: amount < askingPriceRange.lowerCents ? "below_range" :
      amount > askingPriceRange.upperCents ? "above_range" : "within_range",
    explanation: "The range covers the middle 50% of comparable asking prices after outlier removal. It is not a sale-price prediction."
  };
}

function assessPersonalFit(input: CalculateDealScoreInput): PersonalFitAssessment {
  const preferences = input.softPreferences;
  const matchedCount = preferences.filter((item) => item.matched === true).length;
  const missedCount = preferences.filter((item) => item.matched === false).length;
  const unknownCount = preferences.length - matchedCount - missedCount;
  const known = matchedCount + missedCount;
  return {
    status: preferences.length === 0 ? "no_preferences" : known === 0 ? "needs_information" :
      unknownCount > 0 ? "partial" : "assessed",
    percent: known === 0 ? null : Math.round(matchedCount / known * 100),
    matchedCount, missedCount, unknownCount, preferences: [...preferences], distance: input.distance,
    explanation: preferences.length === 0 ? "No soft preferences configured for this search." :
      `${matchedCount} matched, ${missedCount} missed, ${unknownCount} unknown. Fit uses only known soft preferences; distance is shown separately.`
  };
}

function assessConfidence(
  input: CalculateDealScoreInput,
  cohort: ComparableCohort,
  market: MarketValueAssessment
): ValuationConfidence {
  const vehicle = input.enrichment.vehicle;
  const facts = [vehicle.make, vehicle.model, vehicle.year, vehicle.mileageKm, vehicle.fuel,
    vehicle.transmission, vehicle.powerHp, input.enrichment.sellerType,
    input.enrichment.price.interpretation === "full_price" ? input.enrichment.price.amountCents : null];
  const knownFactCount = facts.filter((value) => value !== null).length;
  const members = new Set(cohort.members.map((member) => member.listingId));
  const history = new Map(input.marketplaceHistory.map((candidate) => [candidate.listingId, candidate]));
  const recentComparableCount = [...members].filter((id) => {
    const at = history.get(id)?.lastSeenAt;
    return at !== undefined && ageDays(at, input.evaluatedAt) <= 30;
  }).length;
  const missingVariants = vehicle.variant === null || [...members].some((id) =>
    history.get(id)?.enrichment.vehicle.variant == null);
  const priceSpreadPercent = market.askingPriceRange === null || market.medianPriceCents === null ? null :
    roundOne((market.askingPriceRange.upperCents - market.askingPriceRange.lowerCents) / market.medianPriceCents * 100);
  const reasons = [
    `${members.size} comparable vehicles after duplicate and outlier filtering.`,
    `${knownFactCount} of ${facts.length} valuation facts are known.`,
    `${recentComparableCount} of ${members.size} comparables were seen within 30 days.`
  ];
  if (priceSpreadPercent !== null) reasons.push(`The middle asking-price spread is ${priceSpreadPercent}% of the median.`);
  if (members.size < 5) reasons.push("At least 5 comparables are needed for a market estimate.");
  if (missingVariants) reasons.push("Some variants are unknown, so trim-level comparisons are less certain.");
  if (input.enrichment.uncertainties.length > 0) reasons.push("Enrichment contains unresolved uncertainties.");
  if ((input.factConflicts?.length ?? 0) > 0) reasons.push("Captured vehicle facts conflict and need verification.");
  const staleSubject = ageDays(input.lastSeenAt, input.evaluatedAt) > 30;
  if (staleSubject) reasons.push("This listing has not been seen within 30 days.");
  if (market.status === "verify_price") reasons.push("The asking price or vehicle condition needs verification.");
  const low = market.status !== "available" || knownFactCount < 6 || staleSubject ||
    (priceSpreadPercent !== null && priceSpreadPercent > 40) || (input.factConflicts?.length ?? 0) > 0;
  const high = members.size >= 10 && knownFactCount >= 8 && recentComparableCount === members.size &&
    priceSpreadPercent !== null && priceSpreadPercent <= 20 && !missingVariants &&
    input.enrichment.uncertainties.length === 0;
  return {
    level: low ? "low" : high ? "high" : "medium", reasons, knownFactCount,
    totalFactCount: facts.length, comparableCount: members.size, recentComparableCount, priceSpreadPercent
  };
}

function ageDays(at: string, evaluatedAt: string): number {
  const age = (Date.parse(evaluatedAt) - Date.parse(at)) / 86_400_000;
  return Number.isFinite(age) && age >= 0 ? age : Infinity;
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function roundOne(value: number): number { return Math.round(value * 10) / 10; }
