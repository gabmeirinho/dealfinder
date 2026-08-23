import type { FuelType, TransmissionType } from "../searches/index.js";

export const DUPLICATE_FINGERPRINT_VERSION = 1 as const;

export interface VehicleDuplicateFingerprint {
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  mileageKm: number | null;
  fuel: FuelType | null;
  transmission: TransmissionType | null;
}

export interface DuplicateCandidateFingerprint {
  listingId: number;
  textTokens: readonly string[];
  vehicle: VehicleDuplicateFingerprint;
  imageDifferenceHash: string | null;
}

export interface DuplicatePairEvidence {
  leftListingId: number;
  rightListingId: number;
  confidence: "medium" | "high";
  vehicleSimilarity: number;
  textSimilarity: number;
  imageSimilarity: number | null;
  explanation: string;
}

export interface ProbableDuplicateGroup {
  memberListingIds: number[];
  confidence: "medium" | "high";
  pairEvidence: DuplicatePairEvidence[];
  explanation: string;
}
