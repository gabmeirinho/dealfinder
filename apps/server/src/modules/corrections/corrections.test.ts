import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import {
  ListingIngestionService,
  type RawListingObservation
} from "../listings/ingestion/index.js";
import { CorrectionsService } from "./service.js";

describe("corrections service", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("applies per-listing corrections without changing original text", () => {
    const setup = createSetup();
    database = setup.database;
    const listing = ingest(setup, vehicle(1, {
      description: "Particular with verified service history.",
      seller: { type: "private", rating: 4.8, ratingCount: 32, inventorySize: 1 }
    }), "2026-08-23T09:00:00.000Z");
    const service = new CorrectionsService(() => setup.database);

    const corrected = service.correct({
      listingId: listing.id,
      field: "mileageKm",
      value: 118_000,
      reason: "Dashboard user verified the odometer text",
      correctedAt: "2026-08-23T09:05:00.000Z"
    });

    expect(corrected.facts.mileageKm).toBe(118_000);
    expect(corrected.facts.original.title).toBe("Volkswagen Golf 1.6 TDI 2018");
    expect(corrected.facts.original.description).toBe("Particular with verified service history.");
    expect(corrected.facts.seller).toEqual({
      type: "private",
      rating: 4.8,
      ratingCount: 32,
      inventorySize: 1
    });
    expect(setup.database.normalizedVehicles.getFacts(listing.id)?.facts.mileageKm).toBe(128_000);
    expect(service.effectiveFacts(listing.id)?.mileageKm).toBe(118_000);
    expect(setup.database.enrichmentProcessing.getQueueItem(listing.id)).toMatchObject({
      state: "queued",
      sourceNormalizedAt: "2026-08-23T09:05:00.000Z"
    });
  });

  it("recomputes risk and hard-filter decisions after a correction", () => {
    const setup = createSetup();
    database = setup.database;
    const listing = ingest(setup, vehicle(1), "2026-08-23T09:00:00.000Z");
    const service = new CorrectionsService(() => setup.database);
    expect(setup.database.normalizedVehicles.getMatch(listing.id, setup.searchId)?.eligible).toBe(true);

    service.correct({
      listingId: listing.id,
      field: "make",
      value: "Ford",
      correctedAt: "2026-08-23T09:05:00.000Z"
    });
    service.correct({
      listingId: listing.id,
      field: "priceCents",
      value: 50_000,
      correctedAt: "2026-08-23T09:06:00.000Z"
    });

    expect(setup.database.normalizedVehicles.getMatch(listing.id, setup.searchId)).toMatchObject({
      eligible: false,
      hardFailures: [expect.objectContaining({ criterion: "makeKeywords" })]
    });
    expect(setup.database.normalizedVehicles.getRisk(listing.id)).toMatchObject({
      highRiskVerifyPrice: true,
      reasons: [expect.objectContaining({ code: "suspiciously_low_price" })]
    });
  });

  it("does not reuse a proposed rule until explicit approval", () => {
    const setup = createSetup();
    database = setup.database;
    const first = ingest(setup, vehicle(1), "2026-08-23T09:00:00.000Z");
    const service = new CorrectionsService(() => setup.database);
    const correction = service.correct({
      listingId: first.id,
      field: "make",
      value: "VW",
      correctedAt: "2026-08-23T09:01:00.000Z"
    }).correction;
    const proposal = service.proposeRule(correction.id, "2026-08-23T09:02:00.000Z");
    expect(proposal).toMatchObject({
      field: "make",
      sourceValue: "Volkswagen",
      value: "VW",
      status: "pending"
    });

    const second = ingest(setup, vehicle(2), "2026-08-23T10:00:00.000Z");
    expect(setup.database.normalizedVehicles.getFacts(second.id)?.facts.make).toBe("Volkswagen");

    service.approveRule(proposal.id, "2026-08-23T10:05:00.000Z");
    const third = ingest(setup, vehicle(3), "2026-08-23T11:00:00.000Z");
    expect(setup.database.normalizedVehicles.getFacts(third.id)?.facts.make).toBe("VW");
  });

  it("prevents a rejected rule from being approved later", () => {
    const setup = createSetup();
    database = setup.database;
    const listing = ingest(setup, vehicle(1), "2026-08-23T09:00:00.000Z");
    const service = new CorrectionsService(() => setup.database);
    const correction = service.correct({
      listingId: listing.id,
      field: "variant",
      value: "1.6 TDI Comfortline",
      correctedAt: "2026-08-23T09:01:00.000Z"
    }).correction;
    const proposal = service.proposeRule(correction.id, "2026-08-23T09:02:00.000Z");

    expect(service.rejectRule(proposal.id, "2026-08-23T09:03:00.000Z").status).toBe("rejected");
    expect(() => service.approveRule(proposal.id, "2026-08-23T09:04:00.000Z"))
      .toThrow("was already rejected");
    expect(setup.database.corrections.listApprovedRules()).toEqual([]);
  });
});

function createSetup() {
  const database = openDatabase({ filename: ":memory:" });
  const draft = createVehicleSearchDraft("Golf");
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  draft.criteria.maximumMileageKm = { value: 150_000, strength: "hard" };
  const search = database.searches.create(draft);
  return { database, searchId: search.id };
}

function ingest(
  setup: ReturnType<typeof createSetup>,
  candidate: ReturnType<typeof vehicle>,
  observedAt: string
) {
  const result = new ListingIngestionService(() => setup.database).ingestScan({
    searchId: setup.searchId,
    observedAt,
    initialScan: false,
    completeSnapshot: true,
    candidates: [candidate]
  });
  return result.listings[0] as NonNullable<(typeof result.listings)[number]>;
}

function vehicle(index: number, overrides: Partial<RawListingObservation> = {}) {
  const sourceListingId = String(100000000000000 + index);
  return {
    source: "facebook" as const,
    sourceListingId,
    url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
    title: "Volkswagen Golf 1.6 TDI 2018",
    displayedPrice: "14 950 €",
    location: "Lisboa",
    thumbnailUrl: null,
    rawCardFacts: ["128.000 km", "Diesel", "Manual"],
    ...overrides
  };
}
