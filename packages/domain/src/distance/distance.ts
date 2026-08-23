import type {
  Coordinates,
  DistanceProviderAttribution,
  ListingDistance,
  LocalityKey,
  UnknownDistanceReason
} from "./types.js";

const EARTH_RADIUS_KM = 6_371.0088;
const LOCALITY_ALIASES: Readonly<Record<string, string>> = {
  lisbon: "lisboa",
  oporto: "porto"
};

export function normalizeLocality(value: string | null): LocalityKey | null {
  if (value === null) return null;
  const displayName = value.normalize("NFKC").replace(/\s+/gu, " ").trim().split(",")[0]?.trim() ?? "";
  if (displayName === "") return null;
  const folded = displayName.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-PT")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (folded === "") return null;
  return {
    displayName,
    cacheKey: LOCALITY_ALIASES[folded] ?? folded
  };
}

export function straightLineDistanceKm(origin: Coordinates, destination: Coordinates): number {
  validateCoordinates(origin, "Origin");
  validateCoordinates(destination, "Destination");
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const originLatitude = radians(origin.latitude);
  const destinationLatitude = radians(destination.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) * Math.cos(destinationLatitude) *
    Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function approximateDistance(
  origin: Coordinates,
  destination: Coordinates,
  configuredRadiusKm: number,
  attribution: DistanceProviderAttribution
): ListingDistance {
  if (!Number.isFinite(configuredRadiusKm) || configuredRadiusKm <= 0) {
    throw new Error("Configured radius must be a positive number of kilometres");
  }
  const approximateKilometres = Math.round(straightLineDistanceKm(origin, destination) * 10) / 10;
  return {
    status: "approximate",
    approximateKilometres,
    withinConfiguredRadius: approximateKilometres <= configuredRadiusKm,
    method: "straight_line",
    label: `≈ ${approximateKilometres.toFixed(1)} km straight-line`,
    reason: null,
    attribution
  };
}

export function unknownDistance(
  reason: UnknownDistanceReason,
  attribution: DistanceProviderAttribution | null = null
): ListingDistance {
  return {
    status: "unknown",
    approximateKilometres: null,
    withinConfiguredRadius: null,
    method: null,
    label: "Distance unknown",
    reason,
    attribution
  };
}

export function nationwideDistance(): ListingDistance {
  return {
    status: "not_applicable",
    approximateKilometres: null,
    withinConfiguredRadius: null,
    method: null,
    label: "Nationwide search · distance not used",
    reason: null,
    attribution: null
  };
}

function validateCoordinates(coordinates: Coordinates, label: string): void {
  if (!Number.isFinite(coordinates.latitude) || coordinates.latitude < -90 || coordinates.latitude > 90) {
    throw new Error(`${label} latitude must be between -90 and 90`);
  }
  if (!Number.isFinite(coordinates.longitude) || coordinates.longitude < -180 || coordinates.longitude > 180) {
    throw new Error(`${label} longitude must be between -180 and 180`);
  }
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}
