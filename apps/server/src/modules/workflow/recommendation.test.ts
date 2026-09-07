import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";
import { ListingIngestionService } from "../listings/ingestion/index.js";
import { DealScoringService } from "../scoring/service.js";
import { ListingReviewService } from "./service.js";

let database: DatabaseConnection;
afterEach(() => { database?.close(); vi.useRealTimers(); });

describe("best-deal inbox ordering", () => {
  it("ranks before limiting, uses stable ties, isolates searches and omits confirmed mismatches", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Budget cars");
    draft.criteria.searchScope = "broad";
    draft.criteria.priceRange = { strength: "hard", value: { minimumEur: null, maximumEur: 6000 } };
    const search = database.searches.create(draft);
    const ingestion = new ListingIngestionService(() => database);
    const candidate = (id: string, price: number | null) => ({
      source: "standvirtual" as const, sourceListingId: id,
      url: `https://www.standvirtual.com/carros/anuncio/golf-ID${id}.html`,
      title: "Volkswagen Golf 1.4 TSI", displayedPrice: price === null ? null : `${price} €`,
      location: "Lisboa", thumbnailUrl: null, rawCardFacts: ["2010", "120 000 km", "Gasolina", "Manual", "122 cv", "Profissional"]
    });
    const first = ingestion.ingestScan({ searchId: search.id, observedAt: "2026-09-06T12:00:00Z",
      initialScan: true, completeSnapshot: false, candidates: [candidate("BEST", 4000), candidate("TIE", 4000),
        ...[5000, 5100, 5200, 5300, 5400].map((price, index) => candidate(`COMP${index}`, price)), candidate("MISMATCH", 9000)] });
    ingestion.ingestScan({ searchId: search.id, observedAt: "2026-09-07T12:00:00Z", initialScan: false,
      completeSnapshot: false, candidates: Array.from({ length: 251 }, (_, i) => candidate(`UNKNOWN${i}`, null)) });
    new DealScoringService({ database: () => database }).recomputeAll("2026-09-07T12:00:00Z");
    const workflow = new ListingReviewService(() => database);
    const best = workflow.list({ searchId: search.id, sort: "best_deal" }) as Array<{ id: number; recommendation: { band: string }; assessmentSearchName: string }>;
    expect(best).toHaveLength(250);
    expect(best.slice(0, 2).map((item) => item.id)).toEqual([first.listings[1]!.id, first.listings[0]!.id]);
    expect(best[0]?.recommendation.band).toBe("strong_candidate");
    expect(best.some((item) => item.id === first.listings.at(-1)!.id)).toBe(false);
    expect(workflow.list({ searchId: search.id, sort: "best_deal" })).toEqual(best);
    expect((workflow.list({ searchId: search.id, sort: "recent" })[0] as { id: number }).id).not.toBe(best[0]!.id);
    const otherDraft = createVehicleSearchDraft("Lower budget");
    otherDraft.criteria.searchScope = "broad";
    otherDraft.criteria.priceRange = { strength: "hard", value: { minimumEur: null, maximumEur: 3000 } };
    const other = database.searches.create(otherDraft);
    ingestion.ingestScan({ searchId: other.id, observedAt: "2026-09-07T13:00:00Z", initialScan: true,
      completeSnapshot: false, candidates: [candidate("BEST", 4000)] });
    expect(workflow.list({ searchId: other.id, sort: "best_deal" })).toEqual([]);
    expect(best[0]!.assessmentSearchName).toBe("Budget cars");
  });
});
