import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";
import type { BrowserManager } from "../../browser/index.js";
import { ListingIngestionService } from "../ingestion/index.js";
import { ListingDetailCaptureService } from "./service.js";
import { DealScoringService } from "../../scoring/service.js";
const valid = readFileSync(new URL("../../../../test/fixtures/standvirtual/detail/valid.html", import.meta.url), "utf8");
let db: DatabaseConnection;
let searchId: string;
let at: Date;
const candidate = (id: string, price: string | null = "5500 €") => ({ source: "standvirtual" as const, sourceListingId: id, url: `https://www.standvirtual.com/carros/anuncio/golf-ID${id}.html`, title: "Volkswagen Golf 1.4 TSI", description: null, displayedPrice: price, location: "Lisboa", thumbnailUrl: null, rawCardFacts: ["2009", "100 000 km", "Gasolina", "Manual", "Importado"] });
function ingest(id: string, price: string | null = "5500 €") {
  return new ListingIngestionService(() => db).ingestScan({ searchId, observedAt: new Date(at.getTime()+Number(id.replace(/\D/g, "") || 0)).toISOString(), initialScan: true, completeSnapshot: false, candidates: [candidate(id, price)] }).listings[0]!;
}
beforeEach(() => {
  db = openDatabase({ filename: ":memory:" }); at = new Date("2026-09-08T12:00:00Z");
  const draft = createVehicleSearchDraft("Budget cars"); draft.criteria.searchScope = "broad";
  draft.criteria.priceRange = { strength: "hard", value: { minimumEur: null, maximumEur: 6000 } };
  searchId = db.searches.create(draft).id;
});
afterEach(() => db.close());
function setup(html = valid) {
  let url = "";
  const browser = { navigateListing: vi.fn(async (target: string) => { url=target; return url; }), snapshotListingDetail: vi.fn(async () => ({ url, html, title: "Golf", bodyText: "", loading: false })) };
  const wake = vi.fn();
  const service = new ListingDetailCaptureService({ database: () => db, browser: () => browser as unknown as BrowserManager, now: () => at, processingWake: wake });
  return { browser, service, wake };
}
describe("Standvirtual detail capture", () => {
  it("persists source evidence, conflicts and authoritative facts, rescores, and preserves details on later card scans", async () => {
    const listing = ingest("6One"); const { service, wake } = setup();
    await service.capture(listing.id);
    expect(db.listingDetailFacts.get(listing.id)).toMatchObject({ source: "standvirtual", evidence: { warranty: "18 Meses", importStatus: "national" }, mileage: { source: "standvirtual_structured", conflict: true } });
    expect(db.listingDetailFacts.get(listing.id)?.conflicts).toEqual(expect.arrayContaining(["year", "mileageKm"]));
    expect(db.normalizedVehicles.getFacts(listing.id)?.facts).toMatchObject({ year: 2010, mileageKm: 130000, seller: { type: "dealer" }, indicators: { imported: false } });
    expect(db.dealScores.get(listing.id, searchId)?.score.recommendation).toBeDefined();
    expect(db.listingDetailCaptureAttempts.get(listing.id)?.state).toBe("succeeded"); expect(wake).toHaveBeenCalledOnce();
    at = new Date("2026-09-09T12:00:00Z"); ingest("6One");
    expect(db.normalizedVehicles.getFacts(listing.id)?.facts).toMatchObject({ mileageKm: 130000, seller: { type: "dealer" }, indicators: { imported: false } });
  });
  it("re-evaluates hard constraints and removes scores for a confirmed mismatch", async () => {
    const listing = ingest("6One"); const search = db.searches.get(searchId)!;
    db.searches.update(searchId, { ...search, criteria: { ...search.criteria, maximumMileageKm: { strength: "hard", value: 120000 } } });
    new DealScoringService({ database: () => db }).recomputeAll(at.toISOString());
    await setup().service.capture(listing.id);
    expect(db.normalizedVehicles.getMatch(listing.id, searchId)?.status).toBe("excluded");
    expect(db.dealScores.get(listing.id, searchId)).toBeUndefined();
  });
  it("honors successful and failed cooldowns without losing a listing or false verification", async () => {
    const listing = ingest("6One"); const { service, browser } = setup();
    browser.navigateListing.mockRejectedValueOnce(Object.assign(new Error("Browser closed"), { code: "BROWSER_NOT_OPEN" }));
    await expect(service.capture(listing.id)).rejects.toThrow("Browser closed");
    expect(db.listings.get(listing.id)).toBeDefined(); expect(db.listingDetailFacts.get(listing.id)).toBeUndefined();
    await expect(service.capture(listing.id)).rejects.toMatchObject({ code: "DETAIL_CAPTURE_COOLDOWN" });
    at = new Date("2026-09-09T12:00:01Z"); await service.capture(listing.id);
    await expect(service.capture(listing.id)).rejects.toMatchObject({ code: "DETAIL_CAPTURE_COOLDOWN" });
    expect(browser.navigateListing).toHaveBeenCalledTimes(2);
  });
  it("captures a bounded batch of eligible Standvirtual listings and stops on challenges", async () => {
    for (let i=1;i<=7;i++) ingest(`6Car${i}`);
    ingest("6Unknown", null);
    const { service, browser } = setup();
    expect(await service.captureEligible(searchId, 2, "standvirtual")).toMatchObject({ attempted: 2, succeeded: 2 });
    expect(browser.navigateListing).toHaveBeenCalledTimes(2);
    browser.snapshotListingDetail.mockImplementation(async () => ({ url: await browser.navigateListing.mock.results.at(-1)!.value, html: '<h1>Verify you are human</h1>', title: '', bodyText: '', loading: false }));
    expect(await service.captureEligible(searchId, 5, "standvirtual")).toMatchObject({ attempted: 1, failed: 1, blocked: true });
    expect(db.listingDetailFacts.get(db.listings.getBySource("standvirtual", "6Unknown")!.id)).toBeUndefined();
  });
  it("serializes simultaneous requests and skips recently captured listings", async () => {
    const one = ingest("6One"); const two = ingest("6Two2");
    const { service, browser } = setup();
    let reading = false;
    const original = browser.snapshotListingDetail.getMockImplementation()!;
    browser.snapshotListingDetail.mockImplementation(async () => {
      expect(reading).toBe(false); reading = true;
      await Promise.resolve(); const snapshot = await original(); reading = false; return snapshot;
    });
    await Promise.all([service.capture(one.id), service.capture(two.id)]);
    expect(browser.navigateListing.mock.calls.map(([url]) => url)).toEqual([one.listingUrl, two.listingUrl]);
    expect(await service.captureEligible(searchId, 5, "standvirtual")).toMatchObject({ attempted: 0 });
  });

  it("selects the recommendation leader for automatic capture", async () => {
    const cheap = ingest("6Cheap", "4000 €");
    for (let i=1;i<=6;i++) ingest(`6Comparable${i}`, `${5000+i*100} €`);
    new DealScoringService({ database: () => db }).recomputeAll(new Date(at.getTime()+1000).toISOString());
    const { service, browser } = setup();
    await service.captureEligible(searchId, 1, "standvirtual");
    expect(browser.navigateListing).toHaveBeenCalledWith(cheap.listingUrl);
  });

  it("rolls back all detail facts if persistence fails", async () => {
    const listing = ingest("6One"); const before = db.normalizedVehicles.getFacts(listing.id);
    vi.spyOn(db.normalizedVehicles, "saveRisk").mockImplementationOnce(() => { throw new Error("Write failed"); });
    await expect(setup().service.capture(listing.id)).rejects.toThrow("Write failed");
    expect(db.listingDetailFacts.get(listing.id)).toBeUndefined(); expect(db.listingDetailDescriptions.get(listing.id)).toBeUndefined();
    expect(db.normalizedVehicles.getFacts(listing.id)).toEqual(before);
    expect(db.listingDetailCaptureAttempts.get(listing.id)?.state).toBe("failed");
  });
});
