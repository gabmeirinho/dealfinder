import { afterEach, describe, expect, it } from "vitest";

import { createVehicleSearchDraft } from "@dealfinder/domain";

import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

describe("raw candidates repository", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(() => testDatabase?.cleanup());

  it("stores candidates and their lossless raw observations", () => {
    testDatabase = createTestDatabase();
    const search = testDatabase.connection.searches.create(searchDraft());
    const saved = testDatabase.connection.rawCandidates.saveObservation({
      searchId: search.id,
      observedAt: "2026-08-23T09:00:00.000Z",
      candidate: candidate()
    });

    expect(saved.inserted).toBe(true);
    expect(saved.candidate).toMatchObject({
      sourceListingId: "100000000000001",
      firstSeenAt: "2026-08-23T09:00:00.000Z",
      lastSeenAt: "2026-08-23T09:00:00.000Z"
    });
    expect(saved.observation).toMatchObject({
      searchId: search.id,
      title: "Volkswagen Golf 1.6 TDI 2018",
      rawCardFacts: ["128 000 km", "Diesel"]
    });
  });

  it("is idempotent for the same candidate, search, and observation time", () => {
    testDatabase = createTestDatabase();
    const search = testDatabase.connection.searches.create(searchDraft());
    const input = {
      searchId: search.id,
      observedAt: "2026-08-23T09:00:00.000Z",
      candidate: candidate()
    };

    const first = testDatabase.connection.rawCandidates.saveObservation(input);
    const duplicate = testDatabase.connection.rawCandidates.saveObservation(input);

    expect(first.inserted).toBe(true);
    expect(duplicate.inserted).toBe(false);
    expect(testDatabase.connection.rawCandidates.listObservations(first.candidate.id)).toHaveLength(1);
  });

  it("tracks first and last sighting while retaining changed observations", () => {
    testDatabase = createTestDatabase();
    const search = testDatabase.connection.searches.create(searchDraft());
    const repository = testDatabase.connection.rawCandidates;
    const later = repository.saveObservation({
      searchId: search.id,
      observedAt: "2026-08-23T11:00:00.000Z",
      candidate: candidate()
    });
    repository.saveObservation({
      searchId: search.id,
      observedAt: "2026-08-23T08:00:00.000Z",
      candidate: { ...candidate(), displayedPrice: "14 500 €" }
    });

    expect(repository.get("facebook", candidate().sourceListingId)).toMatchObject({
      firstSeenAt: "2026-08-23T08:00:00.000Z",
      lastSeenAt: "2026-08-23T11:00:00.000Z"
    });
    expect(repository.listObservations(later.candidate.id)).toHaveLength(2);
  });

  it("deletes observations with the owning search but preserves shared candidates", () => {
    testDatabase = createTestDatabase();
    const search = testDatabase.connection.searches.create(searchDraft());
    const saved = testDatabase.connection.rawCandidates.saveObservation({
      searchId: search.id,
      observedAt: "2026-08-23T09:00:00.000Z",
      candidate: candidate()
    });

    testDatabase.connection.searches.delete(search.id);

    expect(testDatabase.connection.rawCandidates.listObservations(saved.candidate.id)).toEqual([]);
    expect(testDatabase.connection.rawCandidates.get("facebook", candidate().sourceListingId)).toBeDefined();
  });

  it("rejects corrupt observations atomically", () => {
    testDatabase = createTestDatabase();

    expect(() => testDatabase?.connection.rawCandidates.saveObservation({
      searchId: "missing-search",
      observedAt: "2026-08-23T09:00:00.000Z",
      candidate: candidate()
    })).toThrow();
    expect(testDatabase.connection.rawCandidates.get("facebook", candidate().sourceListingId))
      .toBeUndefined();
    expect(() => testDatabase?.connection.rawCandidates.saveObservation({
      searchId: "missing-search",
      observedAt: "not-a-timestamp",
      candidate: { ...candidate(), title: "" }
    })).toThrow("Title must contain 1-1000 characters");
  });
});

function candidate() {
  return {
    source: "facebook" as const,
    sourceListingId: "100000000000001",
    url: "https://www.facebook.com/marketplace/item/100000000000001/",
    title: "Volkswagen Golf 1.6 TDI 2018",
    displayedPrice: "14 950 €",
    location: "Lisboa",
    thumbnailUrl: "https://example.invalid/vehicle-thumbnail-1.jpg",
    rawCardFacts: ["128 000 km", "Diesel"]
  };
}

function searchDraft() {
  const draft = createVehicleSearchDraft("Golf");
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  return draft;
}
