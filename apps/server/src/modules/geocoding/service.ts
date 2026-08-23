import type { DatabaseConnection, StoredListingDistance } from "@dealfinder/db";
import {
  approximateDistance,
  nationwideDistance,
  normalizeLocality,
  unknownDistance,
  type Coordinates,
  type DistanceProviderAttribution,
  type LocalityKey,
  type SearchLocation
} from "@dealfinder/domain";

import type { GeocodingProvider } from "./provider.js";
import { PortugalLocalityProvider } from "./portugal-localities.js";

export interface CalculateListingDistance {
  listingId: number;
  searchId: string;
  searchLocation: SearchLocation;
  listingLocality: string | null;
  calculatedAt: string;
}

type Lookup =
  | { status: "resolved"; coordinates: Coordinates }
  | { status: "not_found" };

export class GeocodingService {
  readonly #database: () => DatabaseConnection;
  readonly #provider: GeocodingProvider;

  public constructor(options: {
    database: () => DatabaseConnection;
    provider?: GeocodingProvider;
  }) {
    this.#database = options.database;
    this.#provider = options.provider ?? new PortugalLocalityProvider();
  }

  public async calculate(input: CalculateListingDistance): Promise<StoredListingDistance> {
    const database = this.#database();
    if (input.searchLocation.mode === "nationwide") {
      return database.geocoding.saveDistance(
        input.listingId,
        input.searchId,
        null,
        normalizeLocality(input.listingLocality)?.cacheKey ?? null,
        nationwideDistance(),
        input.calculatedAt
      );
    }

    const origin = normalizeLocality(input.searchLocation.origin);
    const listing = normalizeLocality(input.listingLocality);
    if (listing === null) {
      return database.geocoding.saveDistance(
        input.listingId,
        input.searchId,
        origin?.cacheKey ?? null,
        null,
        unknownDistance("missing_listing_locality"),
        input.calculatedAt
      );
    }

    const attribution = providerAttribution(this.#provider);
    if (origin === null) {
      return database.geocoding.saveDistance(
        input.listingId,
        input.searchId,
        null,
        listing.cacheKey,
        unknownDistance("origin_not_found", attribution),
        input.calculatedAt
      );
    }
    try {
      const originLookup = await this.lookup(origin, input.calculatedAt);
      if (originLookup.status === "not_found") {
        return database.geocoding.saveDistance(
          input.listingId,
          input.searchId,
          origin.cacheKey,
          listing.cacheKey,
          unknownDistance("origin_not_found", attribution),
          input.calculatedAt
        );
      }
      const listingLookup = origin.cacheKey === listing.cacheKey
        ? originLookup
        : await this.lookup(listing, input.calculatedAt);
      if (listingLookup.status === "not_found") {
        return database.geocoding.saveDistance(
          input.listingId,
          input.searchId,
          origin.cacheKey,
          listing.cacheKey,
          unknownDistance("listing_not_found", attribution),
          input.calculatedAt
        );
      }
      return database.geocoding.saveDistance(
        input.listingId,
        input.searchId,
        origin.cacheKey,
        listing.cacheKey,
        approximateDistance(
          originLookup.coordinates,
          listingLookup.coordinates,
          input.searchLocation.radiusKm,
          attribution
        ),
        input.calculatedAt
      );
    } catch {
      return database.geocoding.saveDistance(
        input.listingId,
        input.searchId,
        origin.cacheKey,
        listing.cacheKey,
        unknownDistance("provider_error", attribution),
        input.calculatedAt
      );
    }
  }

  private async lookup(locality: LocalityKey, at: string): Promise<Lookup> {
    const database = this.#database();
    const cached = database.geocoding.getCached(this.#provider.metadata.id, locality.cacheKey);
    if (cached !== undefined) {
      return cached.coordinates === null
        ? { status: "not_found" }
        : { status: "resolved", coordinates: cached.coordinates };
    }
    const coordinates = await this.#provider.geocode(locality);
    if (coordinates === null) {
      database.geocoding.cacheNotFound(
        this.#provider.metadata.id,
        locality,
        this.#provider.metadata.attribution,
        this.#provider.metadata.rateLimitPolicy,
        at
      );
      return { status: "not_found" };
    }
    database.geocoding.cacheResolved(
      this.#provider.metadata.id,
      locality,
      coordinates,
      this.#provider.metadata.attribution,
      this.#provider.metadata.rateLimitPolicy,
      at
    );
    return { status: "resolved", coordinates };
  }
}

function providerAttribution(provider: GeocodingProvider): DistanceProviderAttribution {
  return {
    provider: provider.metadata.id,
    attribution: provider.metadata.attribution
  };
}
