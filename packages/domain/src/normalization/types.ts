import type { FuelType, SellerType, TransmissionType } from "../searches/index.js";

export interface OriginalVehicleText {
  title: string;
  description: string | null;
  displayedPrice: string | null;
  cardFacts: readonly string[];
}

/** Deliberately excludes seller names, profile URLs, contacts, and identifiers. */
export interface CoarseSellerSignals {
  type: SellerType | null;
  rating: number | null;
  ratingCount: number | null;
  inventorySize: number | null;
}

export interface VehicleIndicators {
  financing: boolean;
  monthlyPayment: boolean;
  deposit: boolean;
  damaged: boolean;
  imported: boolean;
}

export type NormalizedFactField =
  | "priceCents"
  | "year"
  | "mileageKm"
  | "make"
  | "model"
  | "variant"
  | "fuel"
  | "transmission"
  | "powerHp"
  | "sellerType";

export interface NormalizedVehicleFacts {
  original: OriginalVehicleText;
  priceCents: number | null;
  year: number | null;
  mileageKm: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  fuel: FuelType | null;
  transmission: TransmissionType | null;
  powerHp: number | null;
  seller: CoarseSellerSignals;
  indicators: VehicleIndicators;
  evidence: Partial<Record<NormalizedFactField | keyof VehicleIndicators, readonly string[]>>;
}

export interface NormalizeVehicleInput extends OriginalVehicleText {
  referenceYear: number;
  seller?: Partial<CoarseSellerSignals>;
}

export interface FactCorrection {
  field: NormalizedFactField;
  value: string | number | null;
}

export interface ReusableNormalizationRule extends FactCorrection {
  sourceValue: string | number | null;
}
