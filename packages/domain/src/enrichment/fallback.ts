import { ENRICHMENT_SCHEMA_VERSION, type EnrichmentUncertainty, type VehicleEnrichment } from "./types.js";
import type { NormalizedVehicleFacts } from "../normalization/index.js";

/** Creates a conservative, immediately usable enrichment from deterministic parser output. */
export function enrichmentFromNormalizedFacts(facts: NormalizedVehicleFacts): VehicleEnrichment {
  const uncertainties: EnrichmentUncertainty[] = [];
  if (facts.indicators.monthlyPayment || facts.indicators.deposit || facts.priceCents === null) {
    uncertainties.push("price_interpretation");
  }
  if (facts.make === null || facts.model === null) uncertainties.push("vehicle_identity");
  if (facts.year === null) uncertainties.push("year");
  if (facts.mileageKm === null) uncertainties.push("mileage");
  if (facts.fuel === null) uncertainties.push("fuel");
  if (facts.transmission === null) uncertainties.push("transmission");
  if (facts.powerHp === null) uncertainties.push("power");
  if (facts.seller.type === null) uncertainties.push("seller_type");
  if (!facts.indicators.damaged) uncertainties.push("condition");
  if (!facts.indicators.imported) uncertainties.push("import_status");
  const interpretation = facts.indicators.monthlyPayment ? "monthly_payment" as const
    : facts.indicators.deposit ? "deposit" as const
    : facts.priceCents === null ? "unknown" as const
    : "full_price" as const;
  return {
    schemaVersion: ENRICHMENT_SCHEMA_VERSION,
    vehicle: {
      make: facts.make,
      model: facts.model,
      variant: facts.variant,
      year: facts.year,
      mileageKm: facts.mileageKm,
      fuel: facts.fuel,
      transmission: facts.transmission,
      powerHp: facts.powerHp
    },
    price: { amountCents: facts.priceCents, interpretation },
    sellerType: facts.seller.type,
    indicators: { ...facts.indicators },
    uncertainties
  };
}
