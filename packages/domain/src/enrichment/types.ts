import type { FuelType, SellerType, TransmissionType } from "../searches/index.js";

export const DEEPSEEK_ENRICHMENT_MODEL = "deepseek-v4-flash" as const;
export const ENRICHMENT_SCHEMA_VERSION = 1 as const;

export interface EnrichmentInput {
  title: string;
  description: string | null;
  facts: {
    priceCents: number | null;
    year: number | null;
    mileageKm: number | null;
    make: string | null;
    model: string | null;
    variant: string | null;
    fuel: FuelType | null;
    transmission: TransmissionType | null;
    powerHp: number | null;
    sellerType: SellerType | null;
    indicators: {
      financing: boolean;
      monthlyPayment: boolean;
      deposit: boolean;
      damaged: boolean;
      imported: boolean;
    };
  };
}

export type PriceInterpretation =
  | "full_price"
  | "monthly_payment"
  | "deposit"
  | "unknown";

export type EnrichmentUncertainty =
  | "price_interpretation"
  | "vehicle_identity"
  | "year"
  | "mileage"
  | "fuel"
  | "transmission"
  | "power"
  | "seller_type"
  | "condition"
  | "import_status";

/** No free-form evidence or seller fields are accepted from the model. */
export interface VehicleEnrichment {
  schemaVersion: typeof ENRICHMENT_SCHEMA_VERSION;
  vehicle: {
    make: string | null;
    model: string | null;
    variant: string | null;
    year: number | null;
    mileageKm: number | null;
    fuel: FuelType | null;
    transmission: TransmissionType | null;
    powerHp: number | null;
  };
  price: {
    amountCents: number | null;
    interpretation: PriceInterpretation;
  };
  sellerType: SellerType | null;
  indicators: {
    financing: boolean;
    monthlyPayment: boolean;
    deposit: boolean;
    damaged: boolean;
    imported: boolean;
  };
  uncertainties: EnrichmentUncertainty[];
}
