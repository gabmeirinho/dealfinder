import type {
  NormalizedFactField,
  NormalizedVehicleFacts,
  StructuredVehicleFacts
} from "../normalization/index.js";

import type { VehicleEnrichment } from "./types.js";

type StructuredVehicleField = Exclude<NormalizedFactField, "priceCents" | "sellerType">;

/**
 * Keeps non-null marketplace structured facts authoritative over AI output.
 * Human corrections still take precedence over every automated source.
 */
export function applyAuthoritativeStructuredFacts(
  enrichment: VehicleEnrichment,
  normalized: NormalizedVehicleFacts,
  structured: StructuredVehicleFacts | undefined,
  corrected: ReadonlySet<NormalizedFactField> = new Set()
): VehicleEnrichment {
  const choose = <T>(
    field: StructuredVehicleField,
    ai: T | null,
    fallback: T | null,
    source: T | null | undefined
  ): T | null => corrected.has(field) ? fallback : (source ?? ai ?? fallback);

  return {
    ...enrichment,
    vehicle: {
      make: choose("make", enrichment.vehicle.make, normalized.make, structured?.make),
      model: choose("model", enrichment.vehicle.model, normalized.model, structured?.model),
      variant: choose("variant", enrichment.vehicle.variant, normalized.variant, structured?.variant),
      year: choose("year", enrichment.vehicle.year, normalized.year, structured?.year),
      mileageKm: choose("mileageKm", enrichment.vehicle.mileageKm, normalized.mileageKm, structured?.mileageKm),
      fuel: choose("fuel", enrichment.vehicle.fuel, normalized.fuel, structured?.fuel),
      transmission: choose("transmission", enrichment.vehicle.transmission, normalized.transmission, structured?.transmission),
      powerHp: choose("powerHp", enrichment.vehicle.powerHp, normalized.powerHp, structured?.powerHp)
    }
  };
}
