import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft, normalizeVehicleFacts } from "@dealfinder/domain";

import type { DuplicateDetectionService } from "../../modules/duplicates/index.js";
import { DealScoringService } from "../../modules/scoring/index.js";
import { collectStandvirtualResults } from "./collector.js";
import { StandvirtualScanner } from "./scanner.js";
import { createHttpServer, listenHttpServer, closeHttpServer } from "../../app/http.js";

describe("Standvirtual scanner", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("rejects invalid broad drafts before collection", async () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Unbounded");
    draft.criteria.searchScope = "broad";
    const collect = vi.fn();
    vi.spyOn(database.searches, "get").mockReturnValue({
      ...draft, id: "invalid", createdAt: "2026-09-05", updatedAt: "2026-09-05",
      location: { mode: "nationwide", origin: null, radiusKm: null }
    });
    const scanner = new StandvirtualScanner({
      database: () => database!,
      scoring: new DealScoringService({ database: () => database! }),
      duplicates: { recomputeAll: vi.fn() } as unknown as DuplicateDetectionService,
      collect
    });
    await expect(scanner.scan("invalid")).rejects.toMatchObject({ code: "INVALID_SEARCH", statusCode: 400 });
    expect(collect).not.toHaveBeenCalled();
  });

  it.each(["targeted", "broad"] as const)("ingests and scores %s searches through the API", async (searchScope) => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Petrol Golf under 6k");
    draft.criteria.searchScope = searchScope;
    if (searchScope === "targeted") draft.criteria.modelTarget = {
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
        requestedLimit: 800,
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
    const processingWake = vi.fn();
    const scanner = new StandvirtualScanner({
      database: () => database as DatabaseConnection,
      scoring: new DealScoringService({ database: () => database as DatabaseConnection }),
      duplicates,
      processingWake,
      collect,
      now: () => new Date("2026-09-05T12:00:00.000Z")
    });

    const server = createHttpServer({ database: () => database!, standvirtual: () => scanner });
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });
    let report;
    try {
      const response = await fetch(`http://${address.host}:${address.port}/api/searches/${search.id}/standvirtual/scan`, { method: "POST" });
      expect(response.status).toBe(200);
      report = (await response.json() as { report: unknown }).report;
    } finally {
      await closeHttpServer(server);
    }

    if (searchScope === "targeted") {
      expect(collectedUrls[0]).toContain("filter_enum_make");
      expect(collectedUrls[0]).toContain("filter_enum_model");
      expect(collectedUrls[0]).not.toContain("price%3Ato");
    } else {
      expect(collectedUrls[0]).not.toContain("filter_enum_make");
      expect(collectedUrls[0]).not.toContain("filter_enum_model");
      expect(collectedUrls[0]).toContain("price%3Ato%5D=6000");
    }
    expect(collectedUrls[0]).toContain("filter_enum_fuel_type");
    expect(report).toMatchObject({ searchScope, pricePolicy: searchScope === "broad" ? "strict" : "market_evidence" });
    expect(report).toMatchObject({ collected: 7, eligible: 1, scoresCalculated: 1 });
    expect(database.rawCandidates.get("standvirtual", "GOLF6")).toBeDefined();
    expect(duplicates.recomputeAll).toHaveBeenCalledOnce();
    expect(processingWake).toHaveBeenCalledOnce();
    const aboveBudget = database.listings.getBySource("standvirtual", "GOLF6")!;
    expect(database.normalizedVehicles.getMatch(aboveBudget.id, search.id)?.eligible).toBe(false);
    const eligible = database.listings.getBySource("standvirtual", "GOLF0")!;
    expect(database.dealScores.get(eligible.id, search.id)?.score.marketValue).toMatchObject({
      status: "available", comparableCount: 6, medianPriceCents: 750_000
    });
    expect(database.searches.get(search.id)?.standvirtualScan).toMatchObject({
      lastSuccessAt: "2026-09-05T12:00:00.000Z", report
    });
    if (searchScope === "broad") {
      const partial = new StandvirtualScanner({
        database: () => database!, scoring: new DealScoringService({ database: () => database! }), duplicates,
        collect: async (...args) => ({ ...await collect(...args), partialError: "Page request failed" }),
        now: () => new Date("2026-09-06T12:00:00.000Z")
      });
      await partial.scan(search.id);
      expect(database.searches.get(search.id)?.standvirtualScan).toMatchObject({
        lastSuccessAt: "2026-09-05T12:00:00.000Z", lastError: "Page request failed", report: { partialError: "Page request failed" }
      });
      const failed = new StandvirtualScanner({
        database: () => database!, scoring: new DealScoringService({ database: () => database! }), duplicates,
        collect: async () => { throw new Error("Offline"); }, now: () => new Date("2026-09-07T12:00:00.000Z")
      });
      await expect(failed.scan(search.id)).rejects.toThrow("Offline");
      expect(database.searches.get(search.id)?.standvirtualScan).toMatchObject({
        lastSuccessAt: "2026-09-05T12:00:00.000Z", lastAttemptAt: "2026-09-07T12:00:00.000Z", lastError: "Offline", report: null
      });
    }
  });
});
