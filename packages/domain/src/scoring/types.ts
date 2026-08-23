import type { ListingDistance } from "../distance/index.js";
import type { VehicleEnrichment } from "../enrichment/index.js";
import type { FilterExplanation } from "../normalization/index.js";
import type { VehicleRiskAssessment } from "../risk/index.js";

export const DEAL_SCORE_VERSION = 1 as const;
export const MINIMUM_COMPARABLES = 5 as const;

export type DealScoreConfidence = "low" | "medium" | "high";
export type MarketDataStatus = "sufficient" | "insufficient";
export type DealScoreComponentKey =
  | "price_position"
  | "preferences"
  | "freshness"
  | "distance"
  | "data_completeness"
  | "risk";

export interface ComparableListingInput {
  listingId: number;
  enrichment: VehicleEnrichment;
  highRiskVerifyPrice: boolean;
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

export interface DealScoreComponent {
  key: DealScoreComponentKey;
  points: number;
  explanation: string;
}

export interface DealScore {
  version: typeof DEAL_SCORE_VERSION;
  total: number;
  confidence: DealScoreConfidence;
  marketDataStatus: MarketDataStatus;
  marketDataLabel: "Market data available" | "Insufficient market data";
  medianPriceCents: number | null;
  comparableCount: number;
  discountPercent: number | null;
  components: DealScoreComponent[];
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
}

export interface DealScoreCalculation {
  cohort: ComparableCohort;
  score: DealScore;
}
