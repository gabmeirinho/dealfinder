import { afterEach, describe, expect, it } from "vitest";

import { createVehicleSearchDraft } from "@dealfinder/domain";

import { openDatabase, type DatabaseConnection } from "../connection.js";
import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

describe("listing review persistence", () => {
  let testDatabase: TestDatabase | undefined;
  let reopened: DatabaseConnection | undefined;

  afterEach(() => {
    reopened?.close();
    testDatabase?.cleanup();
  });

  it("survives a database restart with notes and rejection reason intact", () => {
    testDatabase = createTestDatabase();
    const database = testDatabase.connection;
    const draft = createVehicleSearchDraft("Golfs");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    const raw = database.rawCandidates.saveObservation({
      searchId: search.id,
      observedAt: "2026-08-24T10:00:00.000Z",
      candidate: {
        source: "facebook",
        sourceListingId: "persist-review",
        url: "https://www.facebook.com/marketplace/item/persist-review/",
        title: "Volkswagen Golf",
        displayedPrice: "12 000 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: []
      }
    });
    const listing = database.listings.ingestObservation({
      rawCandidateId: raw.candidate.id,
      searchId: search.id,
      observedAt: "2026-08-24T10:00:00.000Z",
      initialScan: false,
      source: "facebook",
      sourceListingId: "persist-review",
      listingUrl: raw.candidate.listingUrl,
      title: "Volkswagen Golf",
      displayedPrice: "12 000 €",
      priceCents: 1_200_000
    }).listing;
    database.listingReviews.setState(
      listing.id,
      "rejected",
      "No maintenance history",
      "2026-08-24T11:00:00.000Z"
    );
    database.listingReviews.addNote(listing.id, "Seller could not provide records.", "2026-08-24T11:01:00.000Z");
    database.close();

    reopened = openDatabase({ filename: testDatabase.filename });
    expect(reopened.listingReviews.get(listing.id)).toMatchObject({
      state: "rejected",
      rejectionReason: "No maintenance history"
    });
    expect(reopened.listingReviews.listNotes(listing.id)).toMatchObject([
      { body: "Seller could not provide records." }
    ]);
  });
});
