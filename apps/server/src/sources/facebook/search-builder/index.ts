import type {
  FacebookPostFilter,
  VehicleSearch
} from "@dealfinder/domain";

export interface FacebookSearchBuild {
  url: string;
  supportedFilters: readonly string[];
  postFilters: readonly FacebookPostFilter[];
}

const FACEBOOK_VEHICLES_URL =
  "https://www.facebook.com/marketplace/category/vehicles/";

/**
 * Builds only URL parameters characterized against Facebook's current vehicle
 * category route. Everything else remains an explicit local post-filter.
 */
export function buildFacebookVehicleSearch(search: VehicleSearch): FacebookSearchBuild {
  const url = new URL(FACEBOOK_VEHICLES_URL);
  const supportedFilters: string[] = [];
  const queryParts = uniqueKeywords([
    ...(search.criteria.makeKeywords?.value ?? []),
    ...(search.criteria.modelKeywords?.value ?? []),
    ...(search.criteria.variantKeywords?.value ?? []),
    ...(search.criteria.requiredKeywords?.value ?? [])
  ]);

  if (queryParts.length > 0) {
    url.searchParams.set("query", queryParts.join(" "));
    for (const field of [
      "criteria.makeKeywords",
      "criteria.modelKeywords",
      "criteria.variantKeywords",
      "criteria.requiredKeywords"
    ] as const) {
      const key = field.split(".")[1] as
        | "makeKeywords"
        | "modelKeywords"
        | "variantKeywords"
        | "requiredKeywords";
      if (search.criteria[key] !== null) supportedFilters.push(field);
    }
  }

  const price = search.criteria.priceRange?.value;
  if (price?.minimumEur !== null && price?.minimumEur !== undefined) {
    url.searchParams.set("minPrice", String(price.minimumEur));
  }
  if (price?.maximumEur !== null && price?.maximumEur !== undefined) {
    url.searchParams.set("maxPrice", String(price.maximumEur));
  }
  if (price !== undefined) supportedFilters.push("criteria.priceRange");

  if (search.criteria.minimumYear !== null) {
    url.searchParams.set("minYear", String(search.criteria.minimumYear.value));
    supportedFilters.push("criteria.minimumYear");
  }
  if (search.criteria.maximumMileageKm !== null) {
    url.searchParams.set("maxMileage", String(search.criteria.maximumMileageKm.value));
    supportedFilters.push("criteria.maximumMileageKm");
  }

  return {
    url: url.toString(),
    supportedFilters,
    postFilters: buildPostFilters(search)
  };
}

function buildPostFilters(search: VehicleSearch): FacebookPostFilter[] {
  const filters: FacebookPostFilter[] = [{
    field: "location",
    label: search.location.mode === "nationwide"
      ? "Location: Portugal"
      : `Location: ${search.location.origin} within ${search.location.radiusKm} km`,
    reason: "Confirm Facebook's location and distance controls in the visible browser."
  }];

  if (search.criteria.fuels !== null) filters.push({
    field: "fuels",
    label: `Fuel: ${search.criteria.fuels.value.map(formatChoice).join(", ")}`,
    reason: "Fuel is checked by DealFinder after collection."
  });
  if (search.criteria.transmissions !== null) filters.push({
    field: "transmissions",
    label: `Transmission: ${search.criteria.transmissions.value.join(", ")}`,
    reason: "Transmission is checked by DealFinder after collection."
  });
  if (search.criteria.minimumPowerHp !== null) filters.push({
    field: "minimumPowerHp",
    label: `Minimum power: ${search.criteria.minimumPowerHp.value} hp`,
    reason: "Power is checked by DealFinder after collection."
  });
  if (search.criteria.sellerPreference !== null) filters.push({
    field: "sellerPreference",
    label: `Seller: ${search.criteria.sellerPreference.value}`,
    reason: "Seller preference is checked by DealFinder after collection."
  });
  if (search.criteria.excludedKeywords !== null) filters.push({
    field: "excludedKeywords",
    label: `Exclude: ${search.criteria.excludedKeywords.value.join(", ")}`,
    reason: "Excluded keywords are checked by DealFinder after collection."
  });
  return filters;
}

function formatChoice(value: string): string {
  return value.replaceAll("_", "-").replace("plug-in-hybrid", "plug-in hybrid");
}

function uniqueKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  return keywords.filter((keyword) => {
    const normalized = keyword.toLocaleLowerCase("en");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
