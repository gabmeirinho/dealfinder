import type { ListingDistance } from "../distance/index.js";
import type { VehicleEnrichment } from "../enrichment/index.js";
import type { FilterExplanation } from "../normalization/index.js";
import type { VehicleRiskAssessment } from "../risk/index.js";

export const DEAL_SCORE_VERSION = 2 as const;
export const MINIMUM_COMPARABLES = 5 as const;

export type DealScoreConfidence = "low" | "medium" | "high";
export type MarketDataStatus = "sufficient" | "insufficient";
export interface ComparableListingInput {
  listingId: number;
  enrichment: VehicleEnrichment;
  highRiskVerifyPrice: boolean;
  lastSeenAt?: string;
  duplicateGroupId?: string;
}

export interface ComparableCohortCriteria {
  make: string | null;
  model: string | null;
  variant: string | null;
  yearMinimum: number | null;
  yearMaximum: number | null;
  mileageMinimumKm: number | null;
  mileageMaximumKm: number | null;
  fuel: VehicleEnrichment["vehicle"]["fuel"];
  transmission: VehicleEnrichment["vehicle"]["transmission"];
}

export interface ComparableCohortMember {
  listingId: number;
  priceCents: number;
}

export interface ComparableCohort {
  criteria: ComparableCohortCriteria;
  candidateCount: number;
  members: ComparableCohortMember[];
  excludedOutlierListingIds: number[];
  medianPriceCents: number | null;
  marketDataStatus: MarketDataStatus;
  marketDataLabel: "Market data available" | "Insufficient market data";
}

export interface MarketValueAssessment {
  status: "available" | "insufficient_data" | "verify_price";
  medianPriceCents: number | null;
  askingPriceRange: { lowerCents: number; upperCents: number } | null;
  discountPercent: number | null;
  position: "below_range" | "within_range" | "above_range" | null;
  comparableCount: number;
  explanation: string;
}

export interface PersonalFitAssessment {
  status: "assessed" | "partial" | "needs_information" | "no_preferences";
  percent: number | null;
  matchedCount: number;
  missedCount: number;
  unknownCount: number;
  preferences: readonly FilterExplanation[];
  distance: ListingDistance | null;
  explanation: string;
}

export interface ValuationConfidence {
  level: DealScoreConfidence;
  reasons: string[];
  knownFactCount: number;
  totalFactCount: number;
  comparableCount: number;
  recentComparableCount: number;
  priceSpreadPercent: number | null;
}

export interface DealScore {
  version: typeof DEAL_SCORE_VERSION;
  marketValue: MarketValueAssessment;
  personalFit: PersonalFitAssessment;
  confidence: ValuationConfidence;
}

export interface CalculateDealScoreInput {
  listingId: number;
  enrichment: VehicleEnrichment;
  risk: VehicleRiskAssessment;
  softPreferences: readonly FilterExplanation[];
  distance: ListingDistance | null;
  lastSeenAt: string;
  evaluatedAt: string;
  marketplaceHistory: readonly ComparableListingInput[];
  factConflicts?: readonly string[];
}

export interface DealScoreCalculation {
  cohort: ComparableCohort;
  score: DealScore;
}
