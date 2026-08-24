import type { NormalizedVehicleFacts } from "../normalization/index.js";
import type { EnrichmentInput } from "./types.js";

/** Produces the complete and deliberately narrow provider payload. */
export function createEnrichmentInput(facts: NormalizedVehicleFacts): EnrichmentInput {
  return {
    title: facts.original.title,
    description: facts.original.description,
    facts: {
      priceCents: facts.priceCents,
      year: facts.year,
      mileageKm: facts.mileageKm,
      make: facts.make,
      model: facts.model,
      variant: facts.variant,
      fuel: facts.fuel,
      transmission: facts.transmission,
      powerHp: facts.powerHp,
      sellerType: facts.seller.type,
      indicators: { ...facts.indicators }
    }
  };
}
