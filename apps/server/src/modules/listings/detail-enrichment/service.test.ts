import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import type { BrowserManager } from "../../browser/index.js";
import { ListingIngestionService } from "../ingestion/index.js";
import { ListingDetailCaptureService } from "./service.js";

describe("listing detail capture", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("captures, persists, and queues a sanitized description for enrichment", async () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    const ingestion = new ListingIngestionService(() => database as DatabaseConnection);
    ingestion.ingestScan({
      searchId: search.id,
      observedAt: "2026-09-03T09:00:00.000Z",
      initialScan: false,
      completeSnapshot: true,
      candidates: [{
        source: "facebook",
        sourceListingId: "100000000000020",
        url: "https://www.facebook.com/marketplace/item/100000000000020/",
        title: "Volkswagen Golf 2018",
        description: null,
        displayedPrice: "12 500 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: []
      }]
    });
    const listing = database.listings.getBySource("facebook", "100000000000020");
    const browser = {
      navigateListing: vi.fn(async () => "https://www.facebook.com/marketplace/item/100000000000020/"),
      snapshotListingDetail: vi.fn(async () => ({
        url: "https://www.facebook.com/marketplace/item/100000000000020/",
        title: "Volkswagen Golf 2018",
        bodyText: "Particular, caixa manual, revisão feita.",
        html: `<section data-testid="marketplace-item-description">Particular, caixa manual, revisão feita.</section>`,
        loading: false
      }))
    } as unknown as BrowserManager;
    const service = new ListingDetailCaptureService({
      database: () => database as DatabaseConnection,
      browser: () => browser,
      now: () => new Date("2026-09-03T09:05:00.000Z")
    });

    await expect(service.capture(listing?.id as number)).resolves.toMatchObject({
      listingId: listing?.id,
      description: "Particular, caixa manual, revisão feita.",
      queuedForEnrichment: true
    });
    expect(database.normalizedVehicles.getFacts(listing?.id as number)?.facts.original.description)
      .toBe("Particular, caixa manual, revisão feita.");
    expect(database.listingDetailDescriptions.get(listing?.id as number)).toMatchObject({
      description: "Particular, caixa manual, revisão feita."
    });
    expect(database.enrichmentProcessing.getQueueItem(listing?.id as number)?.state).toBe("queued");
    expect(browser.navigateListing).toHaveBeenCalledWith(
      "https://www.facebook.com/marketplace/item/100000000000020/"
    );
  });

  it("fails closed when Facebook redirects to another listing", async () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    new ListingIngestionService(() => database as DatabaseConnection).ingestScan({
      searchId: search.id,
      observedAt: "2026-09-03T09:00:00.000Z",
      initialScan: false,
      completeSnapshot: true,
      candidates: [{
        source: "facebook",
        sourceListingId: "100000000000021",
        url: "https://www.facebook.com/marketplace/item/100000000000021/",
        title: "Volkswagen Golf 2018",
        description: null,
        displayedPrice: "12 500 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: []
      }]
    });
    const listing = database.listings.getBySource("facebook", "100000000000021");
    const browser = {
      navigateListing: vi.fn(async () => "https://www.facebook.com/marketplace/item/100000000000021/"),
      snapshotListingDetail: vi.fn(async () => ({
        url: "https://www.facebook.com/marketplace/item/another-listing/",
        title: "Another listing",
        bodyText: "",
        html: `<section data-testid="marketplace-item-description">Wrong listing.</section>`,
        loading: false
      }))
    } as unknown as BrowserManager;
    const service = new ListingDetailCaptureService({
      database: () => database as DatabaseConnection,
      browser: () => browser
    });

    await expect(service.capture(listing?.id as number))
      .rejects.toThrow("did not remain on the selected listing");
    expect(database.listingDetailDescriptions.get(listing?.id as number)).toBeUndefined();
  });

  it("uses Facebook structured mileage when the description omits it and records conflicts", async () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    new ListingIngestionService(() => database as DatabaseConnection).ingestScan({
      searchId: search.id,
      observedAt: "2026-09-03T09:00:00.000Z",
      initialScan: false,
      completeSnapshot: true,
      candidates: [{
        source: "facebook",
        sourceListingId: "100000000000022",
        url: "https://www.facebook.com/marketplace/item/100000000000022/",
        title: "Volkswagen Golf 2009",
        description: null,
        displayedPrice: "4 300 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: []
      }]
    });
    const listing = database.listings.getBySource("facebook", "100000000000022");
    const browser = {
      navigateListing: vi.fn(async () => "https://www.facebook.com/marketplace/item/100000000000022/"),
      snapshotListingDetail: vi.fn(async () => ({
        url: "https://www.facebook.com/marketplace/item/100000000000022/",
        title: "Volkswagen Golf 2009",
        bodyText: "Seller did not include mileage.",
        html: `<section data-testid="marketplace-item-description">Seller did not include mileage.</section>
          <script>{"custom_title":"2009 Volkswagen Golf","vehicle_make_display_name":"Volkswagen","vehicle_model_display_name":"Golf","vehicle_odometer_data":{"unit":"KILOMETERS","value":297000}}</script>`,
        loading: false
      }))
    } as unknown as BrowserManager;
    const service = new ListingDetailCaptureService({
      database: () => database as DatabaseConnection,
      browser: () => browser,
      now: () => new Date("2026-09-03T09:05:00.000Z")
    });

    await service.capture(listing?.id as number);
    expect(database.normalizedVehicles.getFacts(listing?.id as number)?.facts.mileageKm).toBe(297_000);
    expect(database.listingDetailFacts.get(listing?.id as number)).toMatchObject({
      mileage: {
        structuredKm: 297_000,
        descriptionKm: null,
        selectedKm: 297_000,
        source: "facebook_structured",
        conflict: false
      },
      conflicts: []
    });

    const conflictBrowser = {
      navigateListing: vi.fn(async () => "https://www.facebook.com/marketplace/item/100000000000022/"),
      snapshotListingDetail: vi.fn(async () => ({
        url: "https://www.facebook.com/marketplace/item/100000000000022/",
        title: "Volkswagen Golf 2009",
        bodyText: "287.000 km",
        html: `<section data-testid="marketplace-item-description">287.000 km</section>
          <script>{"vehicle_odometer_data":{"unit":"KILOMETERS","value":297000}}</script>`,
        loading: false
      }))
    } as unknown as BrowserManager;
    const conflictService = new ListingDetailCaptureService({
      database: () => database as DatabaseConnection,
      browser: () => conflictBrowser,
      now: () => new Date("2026-09-03T09:06:00.000Z")
    });
    await conflictService.capture(listing?.id as number);
    expect(database.normalizedVehicles.getFacts(listing?.id as number)?.facts.mileageKm).toBe(297_000);
    expect(database.listingDetailFacts.get(listing?.id as number)).toMatchObject({
      mileage: { structuredKm: 297_000, descriptionKm: 287_000, selectedKm: 297_000, conflict: true },
      conflicts: ["mileageKm"]
    });
  });

  it("captures structured Facebook metadata when the seller description is unavailable", async () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    new ListingIngestionService(() => database as DatabaseConnection).ingestScan({
      searchId: search.id,
      observedAt: "2026-09-03T09:00:00.000Z",
      initialScan: false,
      completeSnapshot: true,
      candidates: [{
        source: "facebook",
        sourceListingId: "100000000000023",
        url: "https://www.facebook.com/marketplace/item/100000000000023/",
        title: "Volkswagen Golf 2020",
        description: null,
        displayedPrice: "18 500 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: []
      }]
    });
    const listing = database.listings.getBySource("facebook", "100000000000023");
    const browser = {
      navigateListing: vi.fn(async () => "https://www.facebook.com/marketplace/item/100000000000023/"),
      snapshotListingDetail: vi.fn(async () => ({
        url: "https://www.facebook.com/marketplace/item/100000000000023/",
        title: "Volkswagen Golf 2020",
        bodyText: "",
        html: `<script>{"vehicle_make_display_name":"Volkswagen","vehicle_model_display_name":"Golf","vehicle_fuel_type":"DIESEL","vehicle_transmission_type":"MANUAL"}</script>`,
        loading: false
      }))
    } as unknown as BrowserManager;
    const service = new ListingDetailCaptureService({
      database: () => database as DatabaseConnection,
      browser: () => browser,
      now: () => new Date("2026-09-03T09:05:00.000Z")
    });

    await expect(service.capture(listing?.id as number)).resolves.toMatchObject({
      listingId: listing?.id,
      description: null,
      queuedForEnrichment: true
    });
    expect(database.listingDetailDescriptions.get(listing?.id as number)).toBeUndefined();
    expect(database.listingDetailFacts.get(listing?.id as number)).toMatchObject({
      structuredFacts: { make: "Volkswagen", model: "Golf", fuel: "diesel", transmission: "manual" },
      selectedFacts: { make: "Volkswagen", model: "Golf", fuel: "diesel", transmission: "manual" }
    });
    expect(database.normalizedVehicles.getFacts(listing?.id as number)?.facts).toMatchObject({
      make: "Volkswagen", model: "Golf", fuel: "diesel", transmission: "manual"
    });

    new ListingIngestionService(() => database as DatabaseConnection).ingestScan({
      searchId: search.id,
      observedAt: "2026-09-03T09:10:00.000Z",
      initialScan: false,
      completeSnapshot: false,
      candidates: [{
        source: "facebook",
        sourceListingId: "100000000000023",
        url: "https://www.facebook.com/marketplace/item/100000000000023/",
        title: "Volkswagen Golf 2020",
        description: null,
        displayedPrice: "18 500 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: []
      }]
    });
    expect(database.normalizedVehicles.getFacts(listing?.id as number)?.facts).toMatchObject({
      make: "Volkswagen", model: "Golf", fuel: "diesel", transmission: "manual"
    });
  });
});
