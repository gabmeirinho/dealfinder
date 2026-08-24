import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import {
  createVehicleSearchDraft,
  type Coordinates,
  type LocalityKey
} from "@dealfinder/domain";

import { ListingIngestionService } from "../listings/ingestion/index.js";
import type { GeocodingProvider } from "./provider.js";
import { GeocodingService } from "./service.js";

describe("geocoding service", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("calculates Lisbon-area straight-line distance and reuses cached localities", async () => {
    const setup = createSetup();
    database = setup.database;
    const provider = new FakeProvider({
      lisboa: { latitude: 38.7223, longitude: -9.1393 },
      setubal: { latitude: 38.5244, longitude: -8.8882 }
    });
    const service = new GeocodingService({ database: () => setup.database, provider });
    const first = ingest(setup, 1, "2026-08-23T09:00:00.000Z");
    const second = ingest(setup, 2, "2026-08-23T10:00:00.000Z");

    const distance = await service.calculate({
      listingId: first.id,
      searchId: setup.searchId,
      searchLocation: setup.search.location,
      listingLocality: "Setúbal, Portugal",
      calculatedAt: "2026-08-23T09:00:00.000Z"
    });
    await service.calculate({
      listingId: second.id,
      searchId: setup.searchId,
      searchLocation: setup.search.location,
      listingLocality: "Setubal",
      calculatedAt: "2026-08-23T10:00:00.000Z"
    });

    expect(distance.distance).toMatchObject({
      status: "approximate",
      approximateKilometres: expect.any(Number),
      withinConfiguredRadius: true,
      method: "straight_line",
      label: expect.stringContaining("straight-line"),
      attribution: {
        provider: "fake-portugal",
        attribution: "Synthetic test centroids"
      }
    });
    expect(provider.calls).toEqual(["lisboa", "setubal"]);
    expect(setup.database.geocoding.getCached("fake-portugal", "lisboa")).toMatchObject({
      rateLimitPolicy: "At most one request per second in tests"
    });
  });

  it("marks a same-locality listing as approximately zero kilometres with one lookup", async () => {
    const setup = createSetup();
    database = setup.database;
    const provider = new FakeProvider({
      lisboa: { latitude: 38.7223, longitude: -9.1393 }
    });
    const listing = ingest(setup, 1, "2026-08-23T09:00:00.000Z");

    const result = await new GeocodingService({
      database: () => setup.database,
      provider
    }).calculate({
      listingId: listing.id,
      searchId: setup.searchId,
      searchLocation: setup.search.location,
      listingLocality: "Lisboa",
      calculatedAt: "2026-08-23T09:00:00.000Z"
    });

    expect(result.distance).toMatchObject({
      status: "approximate",
      approximateKilometres: 0,
      label: "≈ 0.0 km straight-line"
    });
    expect(provider.calls).toEqual(["lisboa"]);
  });

  it("negative-caches unknown localities without excluding the listing", async () => {
    const setup = createSetup();
    database = setup.database;
    const provider = new FakeProvider({
      lisboa: { latitude: 38.7223, longitude: -9.1393 }
    });
    const service = new GeocodingService({ database: () => setup.database, provider });
    const first = ingest(setup, 1, "2026-08-23T09:00:00.000Z");
    const second = ingest(setup, 2, "2026-08-23T10:00:00.000Z");

    for (const [listing, at] of [[first, "2026-08-23T09:00:00.000Z"], [second, "2026-08-23T10:00:00.000Z"]] as const) {
      const result = await service.calculate({
        listingId: listing.id,
        searchId: setup.searchId,
        searchLocation: setup.search.location,
        listingLocality: "Unknown Place",
        calculatedAt: at
      });
      expect(result.distance).toMatchObject({
        status: "unknown",
        reason: "listing_not_found",
        withinConfiguredRadius: null
      });
      expect(setup.database.normalizedVehicles.getMatch(listing.id, setup.searchId)?.eligible).toBe(true);
    }
    expect(provider.calls).toEqual(["lisboa", "unknown place"]);
  });

  it("degrades provider failures to unknown distance without losing the listing", async () => {
    const setup = createSetup();
    database = setup.database;
    const listing = ingest(setup, 1, "2026-08-23T09:00:00.000Z");
    const provider = new FakeProvider({}, true);

    await expect(new GeocodingService({
      database: () => setup.database,
      provider
    }).calculate({
      listingId: listing.id,
      searchId: setup.searchId,
      searchLocation: setup.search.location,
      listingLocality: "Setúbal",
      calculatedAt: "2026-08-23T09:00:00.000Z"
    })).resolves.toMatchObject({
      distance: { status: "unknown", reason: "provider_error" }
    });
    expect(setup.database.listings.get(listing.id)).toBeDefined();
    expect(setup.database.normalizedVehicles.getFacts(listing.id)).toBeDefined();
  });

  it("does not geocode or filter nationwide searches", async () => {
    const setup = createSetup(true);
    database = setup.database;
    const listing = ingest(setup, 1, "2026-08-23T09:00:00.000Z");
    const provider = new FakeProvider({}, true);

    const result = await new GeocodingService({
      database: () => setup.database,
      provider
    }).calculate({
      listingId: listing.id,
      searchId: setup.searchId,
      searchLocation: setup.search.location,
      listingLocality: "Porto",
      calculatedAt: "2026-08-23T09:00:00.000Z"
    });

    expect(result.distance).toMatchObject({
      status: "not_applicable",
      label: "Nationwide search · distance not used"
    });
    expect(provider.calls).toEqual([]);
    expect(setup.database.normalizedVehicles.getMatch(listing.id, setup.searchId)?.eligible).toBe(true);
  });
});

class FakeProvider implements GeocodingProvider {
  public readonly metadata = {
    id: "fake-portugal",
    attribution: "Synthetic test centroids",
    rateLimitPolicy: "At most one request per second in tests"
  };
  public readonly calls: string[] = [];

  public constructor(
    private readonly coordinates: Readonly<Record<string, Coordinates>>,
    private readonly fail = false
  ) {}

  public async geocode(locality: LocalityKey): Promise<Coordinates | null> {
    this.calls.push(locality.cacheKey);
    if (this.fail) throw new Error("Provider unavailable");
    return this.coordinates[locality.cacheKey] ?? null;
  }
}

function createSetup(nationwide = false) {
  const database = openDatabase({ filename: ":memory:" });
  const draft = createVehicleSearchDraft("Golf");
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  if (nationwide) draft.location = { mode: "nationwide", origin: null, radiusKm: null };
  const search = database.searches.create(draft);
  return { database, searchId: search.id, search };
}

function ingest(setup: ReturnType<typeof createSetup>, index: number, observedAt: string) {
  const sourceListingId = String(100000000000000 + index);
  const result = new ListingIngestionService(() => setup.database).ingestScan({
    searchId: setup.searchId,
    observedAt,
    initialScan: false,
    completeSnapshot: false,
    candidates: [{
      source: "facebook",
      sourceListingId,
      url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
      title: "Volkswagen Golf 1.6 TDI 2018",
      displayedPrice: "14 950 €",
      location: "Setúbal",
      thumbnailUrl: null,
      rawCardFacts: ["128.000 km", "Diesel", "Manual"]
    }]
  });
  return result.listings[0] as NonNullable<(typeof result.listings)[number]>;
}
