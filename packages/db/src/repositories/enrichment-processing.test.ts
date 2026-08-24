import { afterEach, describe, expect, it } from "vitest";

import { createVehicleSearchDraft, type VehicleEnrichment } from "@dealfinder/domain";

import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

const AT = "2026-08-23T10:00:00.000Z";

describe("enrichment processing repository", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(() => testDatabase?.cleanup());

  it("claims queued work and advances only a validated current result", () => {
    testDatabase = createTestDatabase();
    const listingId = createListing(testDatabase);
    const repository = testDatabase.connection.enrichmentProcessing;
    repository.enqueue(listingId, AT);

    const claim = repository.claimNext(AT);
    expect(claim).toMatchObject({ listingId, sourceNormalizedAt: AT });
    expect(repository.completeSuccess(claim!, enrichment(), AT, "provider-1")).toBe(true);
    expect(repository.getQueueItem(listingId)?.state).toBe("completed");
    expect(repository.getEnrichment(listingId)?.enrichment).toEqual(enrichment());
  });

  it("rejects invalid results before storing or advancing", () => {
    testDatabase = createTestDatabase();
    const listingId = createListing(testDatabase);
    const repository = testDatabase.connection.enrichmentProcessing;
    repository.enqueue(listingId, AT);
    const claim = repository.claimNext(AT)!;

    expect(() => repository.completeSuccess(
      claim,
      { ...enrichment(), explanation: "untrusted prose" } as VehicleEnrichment,
      AT,
      null
    )).toThrow("missing or unexpected");
    expect(repository.getQueueItem(listingId)?.state).toBe("processing");
    expect(repository.getEnrichment(listingId)).toBeUndefined();
  });

  it("emits one event, pauses claims, retains candidates, and resumes only explicitly", () => {
    testDatabase = createTestDatabase();
    const first = createListing(testDatabase, "100000000000001");
    const second = createListing(testDatabase, "100000000000002");
    const repository = testDatabase.connection.enrichmentProcessing;
    repository.enqueue(first, AT);
    repository.enqueue(second, AT);
    const claim = repository.claimNext(AT)!;

    expect(repository.pauseForInsufficientCredit(claim, AT)).toBe(true);
    expect(repository.getControl()).toMatchObject({ state: "credit_paused", downstreamPaused: true });
    expect(repository.getQueueItem(first)?.state).toBe("queued");
    expect(repository.getQueueItem(second)?.state).toBe("queued");
    expect(repository.claimNext("2026-08-23T10:01:00.000Z")).toBeUndefined();
    expect(testDatabase.connection.database.prepare(`
      SELECT type FROM processing_domain_events
    `).all()).toEqual([{ type: "deepseek_credit_exhausted" }]);

    repository.recordFailedCreditTest("2026-08-23T10:02:00.000Z");
    expect(repository.getControl().state).toBe("credit_paused");
    expect(repository.resumeAfterSuccessfulCreditTest("2026-08-23T10:03:00.000Z")).toBe(true);
    expect(repository.claimNext("2026-08-23T10:03:00.000Z")).toBeDefined();
  });

  it("keeps a newer normalized version queued when an older request completes", () => {
    testDatabase = createTestDatabase();
    const listingId = createListing(testDatabase);
    const repository = testDatabase.connection.enrichmentProcessing;
    repository.enqueue(listingId, AT);
    const claim = repository.claimNext(AT)!;
    repository.enqueue(listingId, "2026-08-23T10:05:00.000Z");

    expect(repository.completeSuccess(claim, enrichment(), "2026-08-23T10:06:00.000Z", null)).toBe(false);
    expect(repository.getQueueItem(listingId)?.state).toBe("queued");
    expect(repository.getEnrichment(listingId)).toBeUndefined();
  });
});

function createListing(testDatabase: TestDatabase, sourceListingId = "100000000000001"): number {
  const database = testDatabase.connection;
  let search = database.searches.list().at(0);
  if (search === undefined) {
    const draft = createVehicleSearchDraft("Test search");
    draft.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
    search = database.searches.create(draft);
  }
  const raw = database.rawCandidates.saveObservation({
    searchId: search.id,
    observedAt: AT,
    candidate: {
      source: "facebook",
      sourceListingId,
      url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
      title: "BMW 320d 2020",
      displayedPrice: "24 900 €",
      location: "Lisboa",
      thumbnailUrl: null,
      rawCardFacts: ["79 500 km"]
    }
  });
  return database.listings.ingestObservation({
    rawCandidateId: raw.candidate.id,
    searchId: search.id,
    observedAt: AT,
    initialScan: false,
    source: "facebook",
    sourceListingId,
    listingUrl: raw.candidate.listingUrl,
    title: raw.observation.title,
    displayedPrice: raw.observation.displayedPrice,
    priceCents: 2_490_000
  }).listing.id;
}

function enrichment(): VehicleEnrichment {
  return {
    schemaVersion: 1,
    vehicle: {
      make: "BMW", model: "320d", variant: null, year: 2020, mileageKm: 79_500,
      fuel: "diesel", transmission: "automatic", powerHp: 190
    },
    price: { amountCents: 2_490_000, interpretation: "full_price" },
    sellerType: "dealer",
    indicators: { financing: false, monthlyPayment: false, deposit: false, damaged: false, imported: false },
    uncertainties: []
  };
}
