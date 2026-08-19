export const SEARCH_CURRENCY = "EUR" as const;
export const SEARCH_DISTANCE_UNIT = "km" as const;
export const SEARCH_POWER_UNIT = "hp" as const;
export const SEARCH_TIMEZONE = "Europe/Lisbon" as const;
export const ACTIVE_SEARCH_SOFT_LIMIT = 10 as const;

export const SEARCH_RADIUS_OPTIONS_KM = [25, 50, 100, 150, 250, 500] as const;

export type SearchRadiusKm = (typeof SEARCH_RADIUS_OPTIONS_KM)[number];
export type ConstraintStrength = "hard" | "soft";
export type FuelType =
  | "petrol"
  | "diesel"
  | "hybrid"
  | "plug_in_hybrid"
  | "electric"
  | "lpg"
  | "other";
export type TransmissionType = "manual" | "automatic";
export type SellerType = "private" | "dealer";

export interface SearchConstraint<T> {
  value: T;
  strength: ConstraintStrength;
}

export interface SearchPriceRange {
  minimumEur: number | null;
  maximumEur: number | null;
}

export interface RadiusSearchLocation {
  mode: "radius";
  origin: string;
  radiusKm: SearchRadiusKm;
}

export interface NationwideSearchLocation {
  mode: "nationwide";
  origin: null;
  radiusKm: null;
}

export type SearchLocation = RadiusSearchLocation | NationwideSearchLocation;

/** Runtime input is deliberately wider than SearchLocation so invalid form states can be reported. */
export interface SearchLocationInput {
  mode: "radius" | "nationwide";
  origin: string | null;
  radiusKm: number | null;
}

export interface VehicleSearchCriteria {
  makeKeywords: SearchConstraint<string[]> | null;
  modelKeywords: SearchConstraint<string[]> | null;
  variantKeywords: SearchConstraint<string[]> | null;
  priceRange: SearchConstraint<SearchPriceRange> | null;
  minimumYear: SearchConstraint<number> | null;
  maximumMileageKm: SearchConstraint<number> | null;
  fuels: SearchConstraint<FuelType[]> | null;
  transmissions: SearchConstraint<TransmissionType[]> | null;
  minimumPowerHp: SearchConstraint<number> | null;
  sellerPreference: SearchConstraint<SellerType> | null;
  requiredKeywords: SearchConstraint<string[]> | null;
  excludedKeywords: SearchConstraint<string[]> | null;
}

export interface VehicleSearchDraft {
  name: string;
  priority: number;
  active: boolean;
  criteria: VehicleSearchCriteria;
  location: SearchLocationInput;
}

export interface ValidatedVehicleSearchDraft
  extends Omit<VehicleSearchDraft, "location"> {
  location: SearchLocation;
}

export interface VehicleSearch extends ValidatedVehicleSearchDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type SearchSourceVerificationState = "unverified" | "verified" | "stale";

/** API-facing search state reserved for the scanner and source adapters added in phase 3. */
export interface ManagedVehicleSearch extends VehicleSearch {
  lastScanAt: string | null;
  nextScanAt: string | null;
  sourceVerification: {
    state: SearchSourceVerificationState;
    verifiedAt: string | null;
  };
}

export interface SearchValidationIssue {
  path: string;
  message: string;
}

export type SearchValidationResult =
  | { success: true; value: ValidatedVehicleSearchDraft }
  | { success: false; issues: SearchValidationIssue[] };
