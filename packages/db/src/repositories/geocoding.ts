import type { DatabaseSync } from "node:sqlite";

import type {
  Coordinates,
  ListingDistance,
  LocalityKey
} from "@dealfinder/domain";

interface CacheRow {
  provider: string;
  locality_key: string;
  display_name: string;
  status: "resolved" | "not_found";
  latitude: number | null;
  longitude: number | null;
  attribution: string;
  rate_limit_policy: string;
  cached_at: string;
}

interface DistanceRow {
  listing_id: number;
  search_id: string;
  status: ListingDistance["status"];
  origin_locality_key: string | null;
  listing_locality_key: string | null;
  approximate_distance_km: number | null;
  within_configured_radius: number | null;
  method: "straight_line" | null;
  display_label: string;
  unknown_reason: ListingDistance["reason"];
  provider: string | null;
  attribution: string | null;
  calculated_at: string;
}

export interface CachedLocality {
  provider: string;
  locality: LocalityKey;
  status: "resolved" | "not_found";
  coordinates: Coordinates | null;
  attribution: string;
  rateLimitPolicy: string;
  cachedAt: string;
}

export interface StoredListingDistance {
  listingId: number;
  searchId: string;
  originLocalityKey: string | null;
  listingLocalityKey: string | null;
  distance: ListingDistance;
  calculatedAt: string;
}

export class GeocodingRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public getCached(provider: string, localityKey: string): CachedLocality | undefined {
    const row = this.database.prepare(`
      SELECT provider, locality_key, display_name, status, latitude, longitude,
             attribution, rate_limit_policy, cached_at
      FROM locality_geocode_cache WHERE provider = ? AND locality_key = ?
    `).get(provider, localityKey) as unknown as CacheRow | undefined;
    return row === undefined ? undefined : mapCache(row);
  }

  public cacheResolved(
    provider: string,
    locality: LocalityKey,
    coordinates: Coordinates,
    attribution: string,
    rateLimitPolicy: string,
    cachedAt: string
  ): CachedLocality {
    this.saveCache(provider, locality, "resolved", coordinates, attribution, rateLimitPolicy, cachedAt);
    return this.getCached(provider, locality.cacheKey) as CachedLocality;
  }

  public cacheNotFound(
    provider: string,
    locality: LocalityKey,
    attribution: string,
    rateLimitPolicy: string,
    cachedAt: string
  ): CachedLocality {
    this.saveCache(provider, locality, "not_found", null, attribution, rateLimitPolicy, cachedAt);
    return this.getCached(provider, locality.cacheKey) as CachedLocality;
  }

  public saveDistance(
    listingId: number,
    searchId: string,
    originLocalityKey: string | null,
    listingLocalityKey: string | null,
    distance: ListingDistance,
    calculatedAt: string
  ): StoredListingDistance {
    validateTimestamp(calculatedAt, "Calculated at");
    this.database.prepare(`
      INSERT INTO listing_distances (
        listing_id, search_id, status, origin_locality_key, listing_locality_key,
        approximate_distance_km, within_configured_radius, method, display_label,
        unknown_reason, provider, attribution, calculated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id, search_id) DO UPDATE SET
        status = excluded.status,
        origin_locality_key = excluded.origin_locality_key,
        listing_locality_key = excluded.listing_locality_key,
        approximate_distance_km = excluded.approximate_distance_km,
        within_configured_radius = excluded.within_configured_radius,
        method = excluded.method,
        display_label = excluded.display_label,
        unknown_reason = excluded.unknown_reason,
        provider = excluded.provider,
        attribution = excluded.attribution,
        calculated_at = excluded.calculated_at
    `).run(
      listingId,
      searchId,
      distance.status,
      originLocalityKey,
      listingLocalityKey,
      distance.approximateKilometres,
      distance.withinConfiguredRadius === null ? null : distance.withinConfiguredRadius ? 1 : 0,
      distance.method,
      distance.label,
      distance.reason,
      distance.attribution?.provider ?? null,
      distance.attribution?.attribution ?? null,
      calculatedAt
    );
    return this.getDistance(listingId, searchId) as StoredListingDistance;
  }

  public getDistance(listingId: number, searchId: string): StoredListingDistance | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, search_id, status, origin_locality_key, listing_locality_key,
             approximate_distance_km, within_configured_radius, method, display_label,
             unknown_reason, provider, attribution, calculated_at
      FROM listing_distances WHERE listing_id = ? AND search_id = ?
    `).get(listingId, searchId) as unknown as DistanceRow | undefined;
    return row === undefined ? undefined : mapDistance(row);
  }

  private saveCache(
    provider: string,
    locality: LocalityKey,
    status: "resolved" | "not_found",
    coordinates: Coordinates | null,
    attribution: string,
    rateLimitPolicy: string,
    cachedAt: string
  ): void {
    validateText(provider, "Provider", 100);
    validateText(attribution, "Attribution", 1000);
    validateText(rateLimitPolicy, "Rate-limit policy", 1000);
    validateTimestamp(cachedAt, "Cached at");
    this.database.prepare(`
      INSERT INTO locality_geocode_cache (
        provider, locality_key, display_name, status, latitude, longitude,
        attribution, rate_limit_policy, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, locality_key) DO UPDATE SET
        display_name = excluded.display_name,
        status = excluded.status,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        attribution = excluded.attribution,
        rate_limit_policy = excluded.rate_limit_policy,
        cached_at = excluded.cached_at
    `).run(
      provider,
      locality.cacheKey,
      locality.displayName,
      status,
      coordinates?.latitude ?? null,
      coordinates?.longitude ?? null,
      attribution,
      rateLimitPolicy,
      cachedAt
    );
  }
}

function mapCache(row: CacheRow): CachedLocality {
  return {
    provider: row.provider,
    locality: { cacheKey: row.locality_key, displayName: row.display_name },
    status: row.status,
    coordinates: row.latitude === null || row.longitude === null
      ? null
      : { latitude: row.latitude, longitude: row.longitude },
    attribution: row.attribution,
    rateLimitPolicy: row.rate_limit_policy,
    cachedAt: row.cached_at
  };
}

function mapDistance(row: DistanceRow): StoredListingDistance {
  const attribution = row.provider === null || row.attribution === null
    ? null
    : { provider: row.provider, attribution: row.attribution };
  let distance: ListingDistance;
  if (row.status === "approximate") {
    distance = {
      status: "approximate",
      approximateKilometres: row.approximate_distance_km as number,
      withinConfiguredRadius: row.within_configured_radius === 1,
      method: "straight_line",
      label: row.display_label,
      reason: null,
      attribution: attribution as NonNullable<typeof attribution>
    };
  } else if (row.status === "unknown") {
    distance = {
      status: "unknown",
      approximateKilometres: null,
      withinConfiguredRadius: null,
      method: null,
      label: "Distance unknown",
      reason: row.unknown_reason as NonNullable<ListingDistance["reason"]>,
      attribution
    };
  } else {
    distance = {
      status: "not_applicable",
      approximateKilometres: null,
      withinConfiguredRadius: null,
      method: null,
      label: "Nationwide search · distance not used",
      reason: null,
      attribution: null
    };
  }
  return {
    listingId: row.listing_id,
    searchId: row.search_id,
    originLocalityKey: row.origin_locality_key,
    listingLocalityKey: row.listing_locality_key,
    distance,
    calculatedAt: row.calculated_at
  };
}

function validateText(value: string, label: string, maximum: number): void {
  if (value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} characters`);
  }
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}
