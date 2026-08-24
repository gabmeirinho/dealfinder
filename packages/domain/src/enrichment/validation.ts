import type { FuelType, SellerType, TransmissionType } from "../searches/index.js";
import {
  ENRICHMENT_SCHEMA_VERSION,
  type EnrichmentUncertainty,
  type PriceInterpretation,
  type VehicleEnrichment
} from "./types.js";

const FUELS: readonly FuelType[] = [
  "petrol", "diesel", "hybrid", "plug_in_hybrid", "electric", "lpg", "other"
];
const TRANSMISSIONS: readonly TransmissionType[] = ["manual", "automatic"];
const SELLER_TYPES: readonly SellerType[] = ["private", "dealer"];
const PRICE_INTERPRETATIONS: readonly PriceInterpretation[] = [
  "full_price", "monthly_payment", "deposit", "unknown"
];
const UNCERTAINTIES: readonly EnrichmentUncertainty[] = [
  "price_interpretation", "vehicle_identity", "year", "mileage", "fuel",
  "transmission", "power", "seller_type", "condition", "import_status"
];

const ROOT_KEYS = ["schemaVersion", "vehicle", "price", "sellerType", "indicators", "uncertainties"] as const;
const VEHICLE_KEYS = ["make", "model", "variant", "year", "mileageKm", "fuel", "transmission", "powerHp"] as const;
const PRICE_KEYS = ["amountCents", "interpretation"] as const;
const INDICATOR_KEYS = ["financing", "monthlyPayment", "deposit", "damaged", "imported"] as const;
const CONTACT_PATTERN = /(?:\b[\w.+-]+@[\w.-]+\.\w{2,}\b|(?:\+?\d[\s().-]*){9,}|https?:\/\/|wa\.me|whatsapp|mailto:|tel:)/iu;

export class InvalidEnrichmentError extends Error {
  readonly code = "invalid_enrichment" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidEnrichmentError";
  }
}

export function parseVehicleEnrichmentJson(content: string): VehicleEnrichment {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new InvalidEnrichmentError("Enrichment response is not valid JSON");
  }
  return validateVehicleEnrichment(value);
}

export function validateVehicleEnrichment(value: unknown): VehicleEnrichment {
  const root = exactObject(value, ROOT_KEYS, "root");
  if (root.schemaVersion !== ENRICHMENT_SCHEMA_VERSION) {
    throw new InvalidEnrichmentError("Unsupported enrichment schema version");
  }

  const vehicle = exactObject(root.vehicle, VEHICLE_KEYS, "vehicle");
  const price = exactObject(root.price, PRICE_KEYS, "price");
  const indicators = exactObject(root.indicators, INDICATOR_KEYS, "indicators");
  if (!Array.isArray(root.uncertainties) || root.uncertainties.length > UNCERTAINTIES.length) {
    throw new InvalidEnrichmentError("uncertainties must be a bounded array");
  }
  const uncertainties = root.uncertainties.map((item) => enumValue(item, UNCERTAINTIES, "uncertainties"));
  if (new Set(uncertainties).size !== uncertainties.length) {
    throw new InvalidEnrichmentError("uncertainties must not contain duplicates");
  }

  return {
    schemaVersion: ENRICHMENT_SCHEMA_VERSION,
    vehicle: {
      make: vehicleText(vehicle.make, "vehicle.make"),
      model: vehicleText(vehicle.model, "vehicle.model"),
      variant: vehicleText(vehicle.variant, "vehicle.variant"),
      year: nullableInteger(vehicle.year, 1886, 2200, "vehicle.year"),
      mileageKm: nullableInteger(vehicle.mileageKm, 0, 10_000_000, "vehicle.mileageKm"),
      fuel: nullableEnum(vehicle.fuel, FUELS, "vehicle.fuel"),
      transmission: nullableEnum(vehicle.transmission, TRANSMISSIONS, "vehicle.transmission"),
      powerHp: nullableInteger(vehicle.powerHp, 1, 5000, "vehicle.powerHp")
    },
    price: {
      amountCents: nullableInteger(price.amountCents, 0, 1_000_000_000, "price.amountCents"),
      interpretation: enumValue(price.interpretation, PRICE_INTERPRETATIONS, "price.interpretation")
    },
    sellerType: nullableEnum(root.sellerType, SELLER_TYPES, "sellerType"),
    indicators: {
      financing: booleanValue(indicators.financing, "indicators.financing"),
      monthlyPayment: booleanValue(indicators.monthlyPayment, "indicators.monthlyPayment"),
      deposit: booleanValue(indicators.deposit, "indicators.deposit"),
      damaged: booleanValue(indicators.damaged, "indicators.damaged"),
      imported: booleanValue(indicators.imported, "indicators.imported")
    },
    uncertainties
  };
}

function exactObject<const K extends readonly string[]>(
  value: unknown,
  keys: K,
  path: string
): Record<K[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidEnrichmentError(`${path} must be an object`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new InvalidEnrichmentError(`${path} has missing or unexpected fields`);
  }
  return value as Record<K[number], unknown>;
}

function vehicleText(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "" || value.length > 120 || CONTACT_PATTERN.test(value)) {
    throw new InvalidEnrichmentError(`${path} must be privacy-safe vehicle text`);
  }
  return value;
}

function nullableInteger(value: unknown, minimum: number, maximum: number, path: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new InvalidEnrichmentError(`${path} must be a bounded integer or null`);
  }
  return value as number;
}

function nullableEnum<T extends string>(value: unknown, choices: readonly T[], path: string): T | null {
  return value === null ? null : enumValue(value, choices, path);
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new InvalidEnrichmentError(`${path} contains an unsupported value`);
  }
  return value as T;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new InvalidEnrichmentError(`${path} must be boolean`);
  return value;
}
