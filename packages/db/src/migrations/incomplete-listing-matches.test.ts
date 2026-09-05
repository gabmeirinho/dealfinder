import { describe, expect, it } from "vitest";
import { createVehicleSearchDraft, normalizeVehicleFacts } from "@dealfinder/domain";
import { openDatabase } from "../connection.js";
import { runMigrations } from "../migration-runner.js";
import { allMigrations } from "./index.js";

describe("incomplete listing migration", () => {
  it("splits legacy failures and queues only previously unprocessed plausible active vehicles", () => {
    const database = openDatabase({ filename: ":memory:", migrations: allMigrations.slice(0, 19) });
    try {
      const draft = createVehicleSearchDraft("Existing search");
      draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
      const search = database.searches.create(draft);
      const at = "2026-09-05T10:00:00.000Z";
      const unknown = { criterion: "fuels", matched: null, explanation: "fuel is unknown" };
      const failure = { criterion: "minimumYear", matched: false, explanation: "year normalized as 2000" };
      const ids: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const sourceListingId = String(100_000_000_000_000 + index);
        const candidate = {
          source: "facebook" as const, sourceListingId,
          url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
          title: "Volkswagen Golf 2020", displayedPrice: "12 500 €",
          location: null, thumbnailUrl: null, rawCardFacts: []
        };
        const raw = database.rawCandidates.saveObservation({ searchId: search.id, observedAt: at, candidate });
        const listing = database.listings.ingestObservation({
          rawCandidateId: raw.candidate.id, searchId: search.id, observedAt: at, initialScan: false,
          source: "facebook", sourceListingId, listingUrl: candidate.url, title: candidate.title,
          displayedPrice: candidate.displayedPrice, priceCents: 1_250_000
        }).listing;
        ids.push(listing.id);
        const facts = normalizeVehicleFacts({
          title: candidate.title, displayedPrice: candidate.displayedPrice, description: null,
          cardFacts: [], referenceYear: 2026
        });
        database.normalizedVehicles.saveFacts(listing.id, raw.observation.id, facts, at);
        database.database.prepare(`INSERT INTO listing_match_evaluations
          (listing_id, search_id, eligible, hard_failures_json, soft_contributions_json, evaluated_at)
          VALUES (?, ?, ?, ?, '[]', ?)`)
          .run(listing.id, search.id, index === 2 ? 1 : 0,
            JSON.stringify(index === 1 ? [unknown, failure] : index === 2 ? [] : [unknown]), at);
      }
      database.listings.markSold(ids[3]!, at, "user");
      database.enrichmentProcessing.enqueue(ids[4]!, at);
      database.database.prepare("UPDATE processing_queue SET state = 'completed' WHERE listing_id = ?")
        .run(ids[4]!);

      expect(runMigrations(database.database, allMigrations).appliedVersions).toEqual([20]);
      expect(database.normalizedVehicles.getMatch(ids[0]!, search.id)).toMatchObject({
        status: "needs_information", eligible: false, hardFailures: [], missingCriteria: [unknown]
      });
      expect(database.normalizedVehicles.getMatch(ids[1]!, search.id)).toMatchObject({
        status: "excluded", hardFailures: [failure], missingCriteria: [unknown]
      });
      expect(database.normalizedVehicles.getMatch(ids[2]!, search.id)).toMatchObject({
        status: "matches", eligible: true, hardFailures: [], missingCriteria: []
      });
      expect(database.enrichmentProcessing.getQueueItem(ids[0]!)?.state).toBe("queued");
      expect(database.enrichmentProcessing.getQueueItem(ids[1]!)).toBeUndefined();
      expect(database.enrichmentProcessing.getQueueItem(ids[3]!)).toBeUndefined();
      expect(database.enrichmentProcessing.getQueueItem(ids[4]!)?.state).toBe("completed");
      expect(runMigrations(database.database, allMigrations).appliedVersions).toEqual([]);
    } finally {
      database.close();
    }
  });
});
