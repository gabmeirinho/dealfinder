import type { NormalizedVehicleFacts, VehicleMatchStatus } from "../normalization/index.js";
import type { VehicleRiskAssessment } from "../risk/index.js";
import type { DealScore } from "./types.js";

export type RecommendationBand = "strong_candidate" | "worth_reviewing" | "needs_verification" | "insufficient_data" | "not_recommended";
export interface RecommendationAssessment {
  band: RecommendationBand;
  /** Internal deterministic ordering, not a user-facing deal score. */
  orderingKey: number;
  reasons: string[];
  warnings: string[];
  freshness: { lastSeenAt: string; evaluatedAt: string; ageDays: number | null; status: "recent" | "stale" | "unknown" };
}
export interface RecommendationInput {
  score: DealScore | null;
  facts: NormalizedVehicleFacts | null;
  risk: VehicleRiskAssessment | null;
  matchStatus: VehicleMatchStatus;
  budget: { minimumEur: number | null; maximumEur: number | null } | null;
  lastSeenAt: string;
  evaluatedAt: string;
  available?: boolean;
}

/** Policy bands dominate all secondary signals. Missing evidence never implies a bargain. */
export function assessRecommendation(input: RecommendationInput): RecommendationAssessment {
  if (!Number.isFinite(Date.parse(input.evaluatedAt))) throw new Error("Evaluated at must be a valid timestamp");
  const { facts, score } = input;
  const elapsed = (Date.parse(input.evaluatedAt) - Date.parse(input.lastSeenAt)) / 86_400_000;
  const ageDays = Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed) : null;
  const freshness: RecommendationAssessment["freshness"] = {
    lastSeenAt: input.lastSeenAt, evaluatedAt: input.evaluatedAt, ageDays,
    status: ageDays === null ? "unknown" : ageDays > 30 ? "stale" : "recent"
  };
  const reasons: string[] = [];
  const warnings = input.risk?.reasons.map((reason) => reason.explanation) ?? [];
  if (input.risk === null) warnings.push("Risk assessment is missing.");
  else if (input.risk.highRiskVerifyPrice && input.risk.reasons.length === 0) warnings.push("Risk assessment requires price verification.");
  if (score?.confidence.level === "low") warnings.push("Valuation evidence has low confidence; verify the vehicle facts and comparables.");
  if (facts?.year == null || facts?.mileageKm == null) warnings.push("Verify the registration year and mileage.");
  const price = facts?.priceCents ?? null;
  const knownPrice = price !== null && price > 0;
  const budgetKnown = input.budget !== null && input.budget.maximumEur !== null;
  const outsideBudget = knownPrice && input.budget !== null &&
    ((input.budget.minimumEur !== null && price < input.budget.minimumEur * 100) ||
     (input.budget.maximumEur !== null && price > input.budget.maximumEur * 100));
  if (!knownPrice) warnings.push("Verify the full asking price.");
  else if (outsideBudget) warnings.push("The asking price is outside the saved search budget.");
  else if (budgetKnown) reasons.push("The asking price is within the saved search budget.");
  else warnings.push("No maximum budget is configured for this search.");
  if (freshness.status === "recent") reasons.push(`Listing last seen ${ageDays} days ago.`);
  else warnings.push(freshness.status === "stale" ? `Listing last seen ${ageDays} days ago; verify availability.` : "Listing freshness is unknown.");
  if (facts?.year != null) reasons.push(`Registered in ${facts.year}.`);
  if (facts?.mileageKm != null) reasons.push(`${facts.mileageKm.toLocaleString("en-GB")} km recorded.`);
  if (score) reasons.push(`${score.confidence.knownFactCount} of ${score.confidence.totalFactCount} valuation facts known; ${score.confidence.level} confidence.`);
  const market = score?.marketValue;
  if (market?.status === "available" && market.discountPercent !== null) {
    reasons.push(`${Math.abs(market.discountPercent)}% ${market.discountPercent >= 0 ? "below" : "above"} the comparable asking-price median (${market.comparableCount} vehicles).`);
  } else warnings.push(market?.status === "verify_price" ? "The market assessment requires price or condition verification." : "Insufficient market data to identify a bargain.");
  if (input.matchStatus === "needs_information") warnings.push("Required search criteria still need verification.");
  if (input.matchStatus === "excluded") warnings.push("Does not meet required search criteria.");
  if (input.available === false) warnings.push("Verify availability before pursuing this listing.");
  let band: RecommendationBand;
  if (input.matchStatus === "excluded" || outsideBudget || input.available === false) band = "not_recommended";
  else if (!knownPrice || input.matchStatus !== "matches" || input.risk === null || input.risk.reasons.length > 0 || input.risk.highRiskVerifyPrice || market?.status === "verify_price" || freshness.status !== "recent") band = "needs_verification";
  else if (!score || market?.status !== "available") band = "insufficient_data";
  else if (score.confidence.level === "low" || !budgetKnown || facts?.year == null || facts.mileageKm === null) band = "needs_verification";
  else if ((market.discountPercent ?? 0) >= 10 && market.position === "below_range") band = "strong_candidate";
  else band = "worth_reviewing";
  // Bounded secondary signals cannot move a candidate into a higher policy band.
  const tier = { not_recommended: 0, needs_verification: 1, insufficient_data: 2, worth_reviewing: 3, strong_candidate: 4 }[band];
  const discount = market?.status === "available" ? Math.max(-100, Math.min(100, market.discountPercent ?? 0)) : 0;
  const confidence = score ? { low: 0, medium: 1, high: 2 }[score.confidence.level] : 0;
  const vehicleAge = facts?.year == null ? 100 : Math.max(0, Math.min(100, new Date(input.evaluatedAt).getUTCFullYear() - facts.year));
  const mileage = Math.max(0, Math.min(3_000_000, facts?.mileageKm ?? 3_000_000));
  const secondary = (discount + 100) * 1000 + confidence * 100 + (score?.confidence.knownFactCount ?? 0) * 5 +
    (30 - Math.min(30, ageDays ?? 30)) + (100 - vehicleAge) / 100 + (3_000_000 - mileage) / 3_000_000;
  return { band, orderingKey: tier * 1_000_000 + secondary, reasons, warnings, freshness };
}
