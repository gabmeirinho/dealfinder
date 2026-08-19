import type { VehicleSearchCriteria, VehicleSearchDraft } from "./types.js";

export const DEFAULT_SEARCH_ORIGIN = "Lisbon, Portugal" as const;
export const DEFAULT_SEARCH_RADIUS_KM = 150 as const;

export function createEmptySearchCriteria(): VehicleSearchCriteria {
  return {
    makeKeywords: null,
    modelKeywords: null,
    variantKeywords: null,
    priceRange: null,
    minimumYear: null,
    maximumMileageKm: null,
    fuels: null,
    transmissions: null,
    minimumPowerHp: null,
    sellerPreference: null,
    requiredKeywords: null,
    excludedKeywords: null
  };
}

export function createVehicleSearchDraft(name = ""): VehicleSearchDraft {
  return {
    name,
    priority: 1,
    active: true,
    criteria: createEmptySearchCriteria(),
    location: {
      mode: "radius",
      origin: DEFAULT_SEARCH_ORIGIN,
      radiusKm: DEFAULT_SEARCH_RADIUS_KM
    }
  };
}
