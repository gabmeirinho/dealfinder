import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft, type VehicleEnrichment } from "@dealfinder/domain";
import { ListingIngestionService } from "./service.js";
import { ListingDetailCaptureService } from "../detail-enrichment/service.js";
import { DealScoringService } from "../../scoring/service.js";
import { ListingReviewService } from "../../workflow/service.js";
import type { BrowserManager } from "../../browser/index.js";
import { DeepSeekClient } from "../../../integrations/deepseek/client.js";
import { DeepSeekEnrichmentService } from "../../../integrations/deepseek/service.js";
import { createLogger } from "../../../logging/index.js";

const AT = "2026-09-05T10:00:00.000Z";
const LATER = "2026-09-05T10:05:00.000Z";

describe("incomplete listing pipeline", () => {
  let database: DatabaseConnection;
  afterEach(() => database?.close());

  function setup() {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Diesel Golfs");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    draft.criteria.fuels = { value: ["diesel"], strength: "hard" };
    draft.criteria.maximumMileageKm = { value: 150_000, strength: "hard" };
    const search = database.searches.create(draft);
    const ingestion = new ListingIngestionService(() => database);
    return { search, ingestion };
  }

  it("queues unknowns, excludes confirmed failures, and exposes pending candidates without scores", () => {
    const { search, ingestion } = setup();
    const result = ingestion.ingestScan({
      searchId: search.id, observedAt: AT, initialScan: false, completeSnapshot: false,
      candidates: [candidate(1), { ...candidate(2), rawCardFacts: ["200 000 km"] }]
    });
    const [pending, excluded] = result.listings;
    expect(database.normalizedVehicles.getMatch(pending!.id, search.id)).toMatchObject({
      status: "needs_information", eligible: false, hardFailures: [],
      missingCriteria: expect.arrayContaining([expect.objectContaining({ criterion: "fuels" })])
    });
    expect(database.enrichmentProcessing.getQueueItem(pending!.id)?.state).toBe("queued");
    expect(database.enrichmentProcessing.getQueueItem(excluded!.id)).toBeUndefined();
    expect(database.normalizedVehicles.getMatch(excluded!.id, search.id)?.status).toBe("excluded");
    expect(new ListingReviewService(() => database).list()).toEqual([
      expect.objectContaining({ id: pending!.id, matchStatus: "needs_information", score: null })
    ]);
    expect(new DealScoringService({ database: () => database }).recomputeAll(LATER)).toEqual([]);
  });

  it("prioritizes incomplete candidates, respects the capture budget, and applies resolved facts", async () => {
    const { search, ingestion } = setup();
    const result = ingestion.ingestScan({
      searchId: search.id, observedAt: AT, initialScan: false, completeSnapshot: false,
      candidates: [
        { ...candidate(1), description: "Diesel, 100 000 km" },
        candidate(2), candidate(3), candidate(4),
        { ...candidate(5), description: "Petrol, 100 000 km" }
      ]
    });
    let url = "";
    const navigateListing = vi.fn(async (value: string) => { url = value; return value; });
    const browser = {
      navigateListing,
      snapshotListingDetail: async () => ({
        url, title: "Golf", bodyText: "", loading: false,
        html: `<section data-testid="marketplace-item-description">${url.includes("100000000000002")
          ? "Diesel, 100 000 km" : "Petrol, 100 000 km"}</section>`
      })
    } as unknown as BrowserManager;
    const service = new ListingDetailCaptureService({
      database: () => database, browser: () => browser, now: () => new Date(LATER)
    });
    expect(await service.captureEligible(search.id, 2)).toMatchObject({ attempted: 2, succeeded: 2 });
    expect(navigateListing.mock.calls.map(([value]) => value)).toEqual([candidate(2).url, candidate(3).url]);
    expect(database.normalizedVehicles.getMatch(result.listings[1]!.id, search.id)?.status).toBe("matches");
    expect(database.normalizedVehicles.getMatch(result.listings[2]!.id, search.id)?.status).toBe("excluded");
    expect(database.normalizedVehicles.getMatch(result.listings[3]!.id, search.id)?.status).toBe("needs_information");
    expect(database.listingDetailCaptureAttempts.findNextEligible(search.id, LATER, AT))
      .toBe(result.listings[3]!.id);
  });

  it.each([
    [null, null, "needs_information"],
    ["diesel", 100_000, "matches"],
    ["petrol", 100_000, "excluded"]
  ] as const)("rechecks AI facts (%s, %s) before scoring", async (fuel, mileageKm, status) => {
    const { search, ingestion } = setup();
    const listing = ingestion.ingestScan({
      searchId: search.id, observedAt: AT, initialScan: false, completeSnapshot: false,
      candidates: [candidate(1)]
    }).listings[0]!;
    const enrichment: VehicleEnrichment = {
      schemaVersion: 1,
      vehicle: { make: "Volkswagen", model: "Golf", variant: null, year: 2020, mileageKm,
        fuel, transmission: "manual", powerHp: null },
      price: { amountCents: 1_250_000, interpretation: "full_price" },
      sellerType: null,
      indicators: { financing: false, monthlyPayment: false, deposit: false, damaged: false, imported: false },
      uncertainties: []
    };
    const client = new DeepSeekClient({ apiKey: "test-key", baseUrl: "http://127.0.0.1:1" });
    vi.spyOn(client, "enrich").mockResolvedValue({ enrichment, providerRequestId: null });
    const scoring = new DealScoringService({ database: () => database });
    const service = new DeepSeekEnrichmentService({
      database: () => database, client, enabled: true, now: () => new Date(LATER),
      logger: createLogger({ sink: () => undefined }),
      afterEnrichment: (id, at) => { scoring.recomputeListing(id, at); }
    });
    expect(await service.processNext()).toBe("succeeded");
    expect(database.normalizedVehicles.getMatch(listing.id, search.id)?.status).toBe(status);
    expect(database.dealScores.get(listing.id, search.id) !== undefined).toBe(status === "matches");

    // New observations must not regain scores from an older AI response while queued.
    ingestion.ingestScan({
      searchId: search.id, observedAt: "2026-09-05T10:10:00.000Z",
      initialScan: false, completeSnapshot: false, candidates: [candidate(1)]
    });
    scoring.recomputeAll("2026-09-05T10:11:00.000Z");
    expect(database.dealScores.get(listing.id, search.id)).toBeUndefined();
    expect(database.normalizedVehicles.getMatch(listing.id, search.id)?.status).toBe("needs_information");
  });

  it("skips queued candidates whose facts now fail every search", async () => {
    const { search, ingestion } = setup();
    const listing = ingestion.ingestScan({
      searchId: search.id, observedAt: AT, initialScan: false, completeSnapshot: false,
      candidates: [candidate(1)]
    }).listings[0]!;
    database.corrections.create(listing.id, { field: "fuel", value: "petrol" }, null, LATER);
    const client = new DeepSeekClient({ apiKey: "test-key", baseUrl: "http://127.0.0.1:1" });
    const enrich = vi.spyOn(client, "enrich");
    const service = new DeepSeekEnrichmentService({
      database: () => database, client, enabled: true, now: () => new Date(LATER),
      logger: createLogger({ sink: () => undefined })
    });
    expect(await service.processNext()).toBe("excluded");
    expect(enrich).not.toHaveBeenCalled();
    expect(database.enrichmentProcessing.getQueueItem(listing.id)).toMatchObject({
      state: "cancelled", lastErrorCode: "excluded_by_filters"
    });
  });
});

function candidate(id: number) {
  const sourceListingId = String(100_000_000_000_000 + id);
  return {
    source: "facebook" as const, sourceListingId,
    url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
    title: "Volkswagen Golf 2020", description: null, displayedPrice: "12 500 €",
    location: "Lisboa", thumbnailUrl: null, rawCardFacts: [] as string[]
  };
}
