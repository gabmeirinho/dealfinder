import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft, normalizeVehicleFacts } from "@dealfinder/domain";

import type { DuplicateDetectionService } from "../../modules/duplicates/index.js";
import { DealScoringService } from "../../modules/scoring/index.js";
import { collectStandvirtualResults } from "./collector.js";
import { StandvirtualScanner } from "./scanner.js";

describe("Standvirtual scanner", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("collects uncapped market data, applies the budget locally, and scores immediately", async () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Petrol Golf under 6k");
    draft.criteria.modelTarget = {
      strength: "hard", value: { make: "Volkswagen", model: "Golf", variant: null }
    };
    draft.criteria.priceRange = {
      strength: "hard", value: { minimumEur: null, maximumEur: 6_000 }
    };
    draft.criteria.fuels = { strength: "hard", value: ["petrol"] };
    const search = database.searches.create(draft);
    const prices = [5_500, 7_000, 7_200, 7_400, 7_600, 7_800, 8_000];
    const collectedUrls: string[] = [];
    const collect = (async (url: string) => {
      collectedUrls.push(url);
      return {
        source: "standvirtual" as const,
        parserVersion: 1,
        scope: "paginated" as const,
        order: "newest_first" as const,
        recognizedCards: prices.length,
        rejectedCards: 0,
        duplicateCards: 0,
        limitReached: false,
        requestedLimit: 100,
        pagesScanned: 1,
        stopReason: "results_end" as const,
        partialError: null,
        listings: prices.map((price, index) => ({
          source: "standvirtual" as const,
          sourceListingId: `GOLF${index}`,
          canonicalUrl: `https://www.standvirtual.com/carros/anuncio/vw-golf-IDGOLF${index}.html`,
          facts: normalizeVehicleFacts({
            title: "Volkswagen Golf 1.4 TSI 2005",
            description: null,
            displayedPrice: `${price} €`,
            cardFacts: [`${100_000 + index * 1_000} km`, "Gasolina", "Manual"],
            referenceYear: 2026
          }),
          missingFields: []
        }))
      };
    }) as typeof collectStandvirtualResults;
    const duplicates = {
      recomputeAll: vi.fn(async () => [])
    } as unknown as DuplicateDetectionService;
    const scanner = new StandvirtualScanner({
      database: () => database as DatabaseConnection,
      scoring: new DealScoringService({ database: () => database as DatabaseConnection }),
      duplicates,
      collect,
      now: () => new Date("2026-09-05T12:00:00.000Z")
    });

    const report = await scanner.scan(search.id);

    expect(collectedUrls[0]).toContain("filter_enum_make");
    expect(collectedUrls[0]).toContain("filter_enum_model");
    expect(collectedUrls[0]).toContain("filter_enum_fuel_type");
    expect(collectedUrls[0]).not.toContain("price%3Ato");
    expect(report).toMatchObject({ collected: 7, eligible: 1, scoresCalculated: 1 });
    expect(database.rawCandidates.get("standvirtual", "GOLF6")).toBeDefined();
    const eligible = database.listings.getBySource("standvirtual", "GOLF0")!;
    expect(database.dealScores.get(eligible.id, search.id)?.score.marketValue).toMatchObject({
      status: "available", comparableCount: 6, medianPriceCents: 750_000
    });
  });
});
