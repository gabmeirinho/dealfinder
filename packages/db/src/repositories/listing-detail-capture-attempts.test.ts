import { afterEach, describe, expect, it } from "vitest";

import {
  assessVehicleRisk,
  createVehicleSearchDraft,
  evaluateVehicleMatch,
  normalizeVehicleFacts
} from "@dealfinder/domain";

import { openDatabase, type DatabaseConnection } from "../connection.js";

describe("listing detail capture attempts", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("selects eligible listings and respects retry and freshness cooldowns", () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    const listing = ingestEligibleListing(database, search.id, "100000000000030");

    const at = "2026-09-03T10:00:00.000Z";
    expect(database.listingDetailCaptureAttempts.findNextEligible(
      search.id,
      at,
      "2026-08-27T10:00:00.000Z"
    )).toBe(listing.id);

    database.listingDetailCaptureAttempts.begin(listing.id, at);
    database.listingDetailCaptureAttempts.completeFailure(
      listing.id,
      at,
      "2026-09-04T10:00:00.000Z",
      "BROWSER_NOT_OPEN"
    );
    expect(database.listingDetailCaptureAttempts.findNextEligible(
      search.id,
      at,
      "2026-08-27T10:00:00.000Z"
    )).toBeUndefined();
    expect(database.listingDetailCaptureAttempts.findNextEligible(
      search.id,
      "2026-09-04T10:00:00.001Z",
      "2026-08-28T10:00:00.001Z"
    )).toBe(listing.id);

    database.listingDetailCaptureAttempts.begin(listing.id, "2026-09-04T10:00:00.001Z");
    database.listingDetailCaptureAttempts.completeSuccess(
      listing.id,
      "2026-09-04T10:00:01.000Z",
      "2026-09-11T10:00:01.000Z"
    );
    expect(database.listingDetailCaptureAttempts.findNextEligible(
      search.id,
      "2026-09-05T10:00:00.000Z",
      "2026-08-29T10:00:00.000Z"
    )).toBeUndefined();
  });

  it("moves interrupted work into a retryable failed state", () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    const listingId = ingestEligibleListing(database, search.id, "100000000000031").id;
    database.listingDetailCaptureAttempts.begin(listingId, "2026-09-03T09:00:00.000Z");

    expect(database.listingDetailCaptureAttempts.recoverInterrupted(
      "2026-09-03T09:05:00.000Z",
      "2026-09-04T09:05:00.000Z"
    )).toBe(1);
    expect(database.listingDetailCaptureAttempts.get(listingId)).toMatchObject({
      state: "failed",
      completedAt: "2026-09-03T09:05:00.000Z",
      nextAttemptAt: "2026-09-04T09:05:00.000Z",
      lastErrorCode: "interrupted"
    });
  });
});

function candidate(sourceListingId: string) {
  return {
    source: "facebook" as const,
    sourceListingId,
    url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
    title: "Volkswagen Golf 2020",
    description: null,
    displayedPrice: "12 500 €",
    location: "Lisboa",
    thumbnailUrl: null,
    rawCardFacts: []
  };
}

function ingestEligibleListing(
  database: DatabaseConnection,
  searchId: string,
  sourceListingId: string
) {
  const observedAt = "2026-09-03T09:00:00.000Z";
  const value = candidate(sourceListingId);
  const raw = database.rawCandidates.saveObservation({
    searchId,
    observedAt,
    candidate: value
  });
  const ingested = database.listings.ingestObservation({
    rawCandidateId: raw.candidate.id,
    searchId,
    observedAt,
    initialScan: false,
    source: value.source,
    sourceListingId: value.sourceListingId,
    listingUrl: value.url,
    title: value.title,
    displayedPrice: value.displayedPrice,
    priceCents: 1_250_000
  });
  const facts = normalizeVehicleFacts({
    title: value.title,
    description: null,
    displayedPrice: value.displayedPrice,
    cardFacts: [],
    referenceYear: 2026
  });
  database.normalizedVehicles.saveFacts(ingested.listing.id, raw.observation.id, facts, observedAt);
  database.normalizedVehicles.saveRisk(ingested.listing.id, assessVehicleRisk(facts), observedAt);
  database.normalizedVehicles.saveMatch(
    ingested.listing.id,
    searchId,
    evaluateVehicleMatch(facts, database.searches.get(searchId)!.criteria),
    observedAt
  );
  return ingested.listing;
}
