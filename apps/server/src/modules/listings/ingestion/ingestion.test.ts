import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { classifyListing, createVehicleSearchDraft } from "@dealfinder/domain";

import { ListingIngestionService, parseDisplayedEuroPrice } from "./service.js";

describe("listing ingestion", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("creates one initial-backlog listing and remains idempotent on replay", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    const input = scan(setup.searchId, "2026-08-23T09:00:00.000Z", true, [candidate()]);

    expect(service.ingestScan(input)).toMatchObject({
      replayed: false,
      observationsInserted: 1,
      listingsCreated: 1,
      priceChanges: 0
    });
    expect(service.ingestScan(input)).toMatchObject({ replayed: true, listingsCreated: 0 });

    const listing = setup.database.listings.getBySource("facebook", candidate().sourceListingId);
    expect(listing).toMatchObject({
      discoveryKind: "initial_backlog",
      availability: "active",
      firstSeenAt: input.observedAt,
      lastSeenAt: input.observedAt,
      currentPriceCents: 1_495_000
    });
    expect(setup.database.listings.listPriceHistory(listing?.id as number)).toHaveLength(1);
    expect(setup.database.listings.listEvents(listing?.id as number)).toEqual([
      expect.objectContaining({ type: "new_listing", meaningful: true, alertable: false })
    ]);
  });

  it("suppresses unchanged repeats and keeps monitoring discoveries alertable", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [candidate()]));
    service.ingestScan(scan(setup.searchId, "2026-08-23T10:00:00.000Z", false, [candidate()]));

    const listing = setup.database.listings.getBySource("facebook", candidate().sourceListingId);
    expect(listing).toMatchObject({
      discoveryKind: "monitoring",
      firstSeenAt: "2026-08-23T09:00:00.000Z",
      lastSeenAt: "2026-08-23T10:00:00.000Z"
    });
    expect(setup.database.listings.listPriceHistory(listing?.id as number)).toHaveLength(1);
    expect(setup.database.listings.listEvents(listing?.id as number)).toEqual([
      expect.objectContaining({ type: "new_listing", alertable: true })
    ]);
  });

  it("records every price transition and applies the price-drop threshold", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [candidate()]));
    service.ingestScan(scan(setup.searchId, "2026-08-23T10:00:00.000Z", false, [
      candidate({ displayedPrice: "14 900 €" })
    ]));
    service.ingestScan(scan(setup.searchId, "2026-08-23T11:00:00.000Z", false, [
      candidate({ displayedPrice: "14 700 €" })
    ]));

    const listing = setup.database.listings.getBySource("facebook", candidate().sourceListingId);
    expect(setup.database.listings.listPriceHistory(listing?.id as number).map((point) => point.priceCents))
      .toEqual([1_495_000, 1_490_000, 1_470_000]);
    expect(setup.database.listings.listEvents(listing?.id as number)).toEqual([
      expect.objectContaining({ type: "new_listing" }),
      expect.objectContaining({ type: "price_changed", meaningful: false, alertable: false }),
      expect.objectContaining({ type: "price_changed", meaningful: true, alertable: true })
    ]);
  });

  it("treats every shortlisted or contacted price change as meaningful", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [candidate()]));
    const listing = setup.database.listings.getBySource("facebook", candidate().sourceListingId);
    const raw = setup.database.rawCandidates.saveObservation({
      searchId: setup.searchId,
      observedAt: "2026-08-23T10:00:00.000Z",
      candidate: candidate({ displayedPrice: "14 951 €" })
    });

    const changed = setup.database.listings.ingestObservation({
      rawCandidateId: raw.candidate.id,
      searchId: setup.searchId,
      observedAt: "2026-08-23T10:00:00.000Z",
      initialScan: false,
      source: "facebook",
      sourceListingId: candidate().sourceListingId,
      listingUrl: candidate().url,
      title: candidate().title,
      displayedPrice: "14 951 €",
      priceCents: 1_495_100,
      engagement: "shortlisted"
    });
    expect(changed.event).toMatchObject({ meaningful: true, alertable: true });
    expect(listing).toBeDefined();
  });

  it("counts only complete-snapshot misses, then expires after 24 hours", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [candidate()]));
    service.ingestScan({
      ...scan(setup.searchId, "2026-08-23T10:00:00.000Z", false, []),
      completeSnapshot: false
    });
    expect(current(setup.database).consecutiveMisses).toBe(0);

    for (const hour of [11, 12, 13]) {
      service.ingestScan(scan(setup.searchId, `2026-08-23T${hour}:00:00.000Z`, false, []));
    }
    expect(current(setup.database)).toMatchObject({
      availability: "possibly_unavailable",
      consecutiveMisses: 3
    });
    expect(service.expireInactive("2026-08-24T08:59:59.999Z")).toEqual([]);
    expect(service.expireInactive("2026-08-24T09:00:00.000Z")).toHaveLength(1);
    expect(current(setup.database).availability).toBe("inactive");
  });

  it("silently restores unchanged reappearances but preserves sold decisions", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [candidate()]));
    for (const hour of [10, 11, 12]) {
      service.ingestScan(scan(setup.searchId, `2026-08-23T${hour}:00:00.000Z`, false, []));
    }
    service.expireInactive("2026-08-24T09:00:00.000Z");
    service.ingestScan(scan(setup.searchId, "2026-08-24T10:00:00.000Z", false, [candidate()]));

    const restored = current(setup.database);
    expect(restored).toMatchObject({ availability: "active", consecutiveMisses: 0 });
    expect(setup.database.listings.listEvents(restored.id)).toHaveLength(1);

    setup.database.listings.markSold(restored.id, "2026-08-24T11:00:00.000Z", "user");
    service.ingestScan(scan(setup.searchId, "2026-08-24T12:00:00.000Z", false, [candidate()]));
    expect(current(setup.database)).toMatchObject({ availability: "sold", soldReason: "user" });
  });

  it("rolls back the scan claim, raw evidence, and listings together", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    const observedAt = "2026-08-23T09:00:00.000Z";
    const broken = candidate({ sourceListingId: "" });

    expect(() => service.ingestScan(scan(setup.searchId, observedAt, false, [candidate(), broken])))
      .toThrow("Source listing ID must contain 1-100 characters");
    expect(setup.database.rawCandidates.get("facebook", candidate().sourceListingId)).toBeUndefined();
    expect(setup.database.listings.getBySource("facebook", candidate().sourceListingId)).toBeUndefined();

    expect(service.ingestScan(scan(setup.searchId, observedAt, false, [candidate()])))
      .toMatchObject({ replayed: false, listingsCreated: 1 });
  });

  it("parses conservative EUR card prices without treating contact text as money", () => {
    expect(parseDisplayedEuroPrice("14 950 €")).toBe(1_495_000);
    expect(parseDisplayedEuroPrice("€12.345,67")).toBe(1_234_567);
    expect(parseDisplayedEuroPrice("12,345.67 €")).toBe(1_234_567);
    expect(parseDisplayedEuroPrice("Grátis")).toBe(0);
    expect(parseDisplayedEuroPrice("Contactar vendedor")).toBeNull();
  });

  it("classifies supplied non-vehicle patterns before enrichment", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);

    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [
      candidate({ title: "Jantes Volkswagen Golf", sourceListingId: "100000000000002" })
    ]));

    const listing = setup.database.listings.getBySource("facebook", "100000000000002");
    expect(setup.database.listingClassifications.get(listing?.id as number)).toMatchObject({
      subject: "part_or_accessory",
      decision: "exclude",
      matchedPatterns: [{ category: "part", pattern: "jantes" }]
    });
    expect(setup.database.normalizedVehicles.getFacts(listing?.id as number)).toBeUndefined();
    expect(setup.database.enrichmentProcessing.getQueueItem(listing?.id as number)).toBeUndefined();
  });

  it("persists a captured description and makes it available to enrichment", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    const description = "Particular, caixa manual, histórico de manutenção completo.";

    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [
      candidate({ description })
    ]));

    const listing = setup.database.listings.getBySource("facebook", candidate().sourceListingId);
    const facts = setup.database.normalizedVehicles.getFacts(listing?.id as number);
    const observation = setup.database.rawCandidates.listObservations(
      setup.database.rawCandidates.get("facebook", candidate().sourceListingId)?.id as number
    )[0];
    expect(observation?.description).toBe(description);
    expect(facts?.facts.original.description).toBe(description);
    expect(facts?.facts.transmission).toBe("manual");
    expect(facts?.facts.seller.type).toBe("private");
  });

  it("records parts-only cars as vehicles while excluding them from enrichment", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);

    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [
      candidate({ title: "Volkswagen Golf só para peças", sourceListingId: "100000000000003" })
    ]));

    const listing = setup.database.listings.getBySource("facebook", "100000000000003");
    expect(setup.database.listingClassifications.get(listing?.id as number)).toMatchObject({
      subject: "whole_vehicle",
      condition: "parts_only",
      decision: "exclude"
    });
  });

  it("does not enrich titles that fail hard search criteria", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);

    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [
      candidate({ title: "Oeiras", sourceListingId: "100000000000004" })
    ]));

    const listing = setup.database.listings.getBySource("facebook", "100000000000004");
    expect(setup.database.normalizedVehicles.getMatch(listing?.id as number, setup.searchId))
      .toMatchObject({ eligible: false });
    expect(setup.database.enrichmentProcessing.getQueueItem(listing?.id as number)).toBeUndefined();
  });

  it("backfills missing and stale classifications idempotently", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    const excluded = createStoredListing(setup, "Bancos Volkswagen Golf 4", "100000000000005");
    const kept = createStoredListing(setup, "Volkswagen Golf 1.6 TDI 2018", "100000000000006");

    expect(service.backfillClassifications("2026-08-23T09:00:00.000Z")).toBe(2);
    expect(setup.database.listingClassifications.get(excluded.id)).toMatchObject({
      version: 2,
      decision: "exclude",
      subject: "part_or_accessory"
    });
    expect(setup.database.listingClassifications.get(kept.id)).toMatchObject({
      version: 2,
      decision: "continue"
    });
    expect(service.backfillClassifications("2026-08-23T10:00:00.000Z")).toBe(0);

    const stale = classifyListing({ title: "Bancos Volkswagen Golf 4" });
    setup.database.listingClassifications.save(
      excluded.id,
      { ...stale, version: 1 },
      "2026-08-23T11:00:00.000Z"
    );
    expect(service.backfillClassifications("2026-08-23T12:00:00.000Z")).toBe(1);
    expect(setup.database.listingClassifications.get(excluded.id)?.version).toBe(2);
  });

  it("cancels existing enrichment when a listing is reclassified as excluded", () => {
    const setup = createSetup();
    database = setup.database;
    const service = new ListingIngestionService(() => setup.database);
    service.ingestScan(scan(setup.searchId, "2026-08-23T09:00:00.000Z", false, [candidate()]));

    const listing = setup.database.listings.getBySource("facebook", candidate().sourceListingId);
    expect(setup.database.enrichmentProcessing.getQueueItem(listing?.id as number)?.state).toBe("queued");

    service.ingestScan(scan(setup.searchId, "2026-08-23T10:00:00.000Z", false, [
      candidate({ title: "Bancos Volkswagen Golf 4" })
    ]));

    expect(setup.database.listingClassifications.get(listing?.id as number)).toMatchObject({
      decision: "exclude",
      subject: "part_or_accessory"
    });
    expect(setup.database.enrichmentProcessing.getQueueItem(listing?.id as number)).toMatchObject({
      state: "cancelled",
      lastErrorCode: "excluded_by_classifier"
    });
    expect(setup.database.normalizedVehicles.getFacts(listing?.id as number)).toBeDefined();
    expect(setup.database.enrichmentProcessing.claimNext("2026-08-23T11:00:00.000Z")).toBeUndefined();
  });
});

function createSetup() {
  const database = openDatabase({ filename: ":memory:" });
  const draft = createVehicleSearchDraft("Golf");
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  return { database, searchId: database.searches.create(draft).id };
}

function scan(
  searchId: string,
  observedAt: string,
  initialScan: boolean,
  candidates: readonly ReturnType<typeof candidate>[]
) {
  return { searchId, observedAt, initialScan, completeSnapshot: true, candidates };
}

function candidate(overrides: Partial<ReturnType<typeof baseCandidate>> = {}) {
  return { ...baseCandidate(), ...overrides };
}

function createStoredListing(
  setup: ReturnType<typeof createSetup>,
  title: string,
  sourceListingId: string
) {
  const raw = setup.database.rawCandidates.saveObservation({
    searchId: setup.searchId,
    observedAt: "2026-08-23T09:00:00.000Z",
    candidate: candidate({ title, sourceListingId })
  });
  return setup.database.listings.ingestObservation({
    rawCandidateId: raw.candidate.id,
    searchId: setup.searchId,
    observedAt: "2026-08-23T09:00:00.000Z",
    initialScan: false,
    source: "facebook",
    sourceListingId,
    listingUrl: raw.candidate.listingUrl,
    title: raw.observation.title,
    displayedPrice: raw.observation.displayedPrice,
    priceCents: 1_495_000
  }).listing;
}

function baseCandidate() {
  return {
    source: "facebook" as const,
    sourceListingId: "100000000000001",
    url: "https://www.facebook.com/marketplace/item/100000000000001/",
    title: "Volkswagen Golf 1.6 TDI 2018",
    displayedPrice: "14 950 €" as string | null,
    location: "Lisboa" as string | null,
    thumbnailUrl: null as string | null,
    description: null as string | null,
    rawCardFacts: ["128 000 km", "Diesel"] as readonly string[]
  };
}

function current(database: DatabaseConnection) {
  return database.listings.getBySource("facebook", candidate().sourceListingId) as NonNullable<
    ReturnType<DatabaseConnection["listings"]["getBySource"]>
  >;
}
