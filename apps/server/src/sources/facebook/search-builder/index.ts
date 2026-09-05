import type {
  FacebookPostFilter,
  VehicleSearch
} from "@dealfinder/domain";

export interface FacebookSearchBuild {
  url: string;
  supportedFilters: readonly string[];
  postFilters: readonly FacebookPostFilter[];
}

const FACEBOOK_ORIGIN = "https://www.facebook.com";
const FACEBOOK_VEHICLES_PATH = "/marketplace/category/vehicles/";

/**
 * Builds only URL parameters characterized against Facebook's current vehicle
 * category route. Everything else remains an explicit local post-filter.
 */
export function buildFacebookVehicleSearch(search: VehicleSearch): FacebookSearchBuild {
  const locationSlug = search.location.mode === "radius"
    ? facebookMarketplaceLocationSlug(search.location.origin)
    : null;
  const url = new URL(
    locationSlug === null
      ? FACEBOOK_VEHICLES_PATH
      : `/marketplace/${locationSlug}/vehicles/`,
    FACEBOOK_ORIGIN
  );
  const supportedFilters: string[] = [];
  const queryParts = uniqueKeywords([
    ...(search.criteria.modelTarget == null ? [] : [search.criteria.modelTarget.value.make, search.criteria.modelTarget.value.model, ...(search.criteria.modelTarget.value.variant ? [search.criteria.modelTarget.value.variant] : [])]),
    ...(search.criteria.makeKeywords?.value ?? []),
    ...(search.criteria.modelKeywords?.value ?? []),
    ...(search.criteria.variantKeywords?.value ?? []),
    ...(search.criteria.requiredKeywords?.value ?? [])
  ]);

  if (search.criteria.modelTarget != null) supportedFilters.push("criteria.modelTarget");
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
  if (search.location.mode === "radius") {
    url.searchParams.set("radius", String(search.location.radiusKm));
    supportedFilters.push("location");
  }

  return {
    url: url.toString(),
    supportedFilters,
    postFilters: buildPostFilters(search)
  };
}

function buildPostFilters(search: VehicleSearch): FacebookPostFilter[] {
  const filters: FacebookPostFilter[] = search.location.mode === "nationwide"
    ? [{
      field: "location",
      label: "Location: Portugal",
      reason: "Confirm Facebook's nationwide location control in the visible browser."
    }]
    : [];

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

export function facebookMarketplaceLocationSlug(origin: string): string {
  const locality = origin.split(",", 1)[0]?.trim() ?? "";
  const slug = locality
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (slug.length === 0) throw new Error(`Cannot create a Facebook location from ${origin}`);
  return slug;
}
