import type { Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import { closeHttpServer, createHttpServer, listenHttpServer } from "../../../app/http.js";
import type { BrowserManager } from "../../browser/index.js";
import { ListingDetailCaptureService } from "../detail-enrichment/index.js";
import { ListingIngestionService } from "../ingestion/index.js";
import { ListingReviewService } from "../../workflow/index.js";

describe("listing review API", () => {
  let database: DatabaseConnection;
  let server: Server | undefined;
  let baseUrl: string;
  let listingId: number;

  beforeEach(async () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Lisbon hatchbacks");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    const ingestion = new ListingIngestionService(() => database);
    const result = ingestion.ingestScan({
      searchId: search.id,
      observedAt: "2026-08-24T10:00:00.000Z",
      initialScan: false,
      completeSnapshot: true,
      candidates: [{
        source: "facebook",
        sourceListingId: "100000000000099",
        url: "https://www.facebook.com/marketplace/item/100000000000099/",
        title: "<script>alert('x')</script> 2020 Volkswagen Golf",
        description: "Excellent car <img src=x onerror=alert(1)>",
        displayedPrice: "14 950 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: ["2020", "80 000 km", "Diesel"]
      }]
    });
    listingId = result.listings[0]?.id as number;
    const workflow = new ListingReviewService(() => database);
    const browser = {
      navigateListing: async () => "https://www.facebook.com/marketplace/item/100000000000099/",
      snapshotListingDetail: async () => ({
        url: "https://www.facebook.com/marketplace/item/100000000000099/",
        title: "Volkswagen Golf 2020",
        bodyText: "Particular, caixa manual, revisão feita.",
        html: `<section data-testid="marketplace-item-description">Particular, caixa manual, revisão feita.</section>`,
        loading: false
      })
    } as unknown as BrowserManager;
    const detailCapture = new ListingDetailCaptureService({
      database: () => database,
      browser: () => browser,
      now: () => new Date("2026-08-24T10:05:00.000Z")
    });
    server = createHttpServer({
      database: () => database,
      listingWorkflow: () => workflow,
      listingDetailCapture: () => detailCapture
    });
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server !== undefined) await closeHttpServer(server);
    database.close();
  });

  it("lists, filters, and persists the complete personal review workflow", async () => {
    const inbox = await getJson<{ listings: Array<{ id: number; review: { state: string } }> }>("/api/listings");
    expect(inbox.listings).toMatchObject([{ id: listingId, review: { state: "new" } }]);

    await mutate(`/api/listings/${listingId}/workflow`, "PATCH", {
      state: "shortlisted", rejectionReason: null
    });
    await mutate(`/api/listings/${listingId}/notes`, "POST", { body: "Ask about timing belt." });
    await mutate(`/api/listings/${listingId}/workflow`, "PATCH", {
      state: "contacted", rejectionReason: null
    });
    await mutate(`/api/listings/${listingId}/workflow`, "PATCH", {
      state: "viewing_arranged", rejectionReason: null
    });
    const rejected = await mutate(`/api/listings/${listingId}/workflow`, "PATCH", {
      state: "rejected", rejectionReason: "Incomplete service history"
    });
    expect(rejected.listing).toMatchObject({
      review: { state: "rejected", rejectionReason: "Incomplete service history" },
      notes: [{ body: "Ask about timing belt." }]
    });

    const filtered = await getJson<{ listings: unknown[] }>("/api/listings?state=rejected");
    expect(filtered.listings).toHaveLength(1);
    await mutate(`/api/listings/${listingId}/archive`, "POST", { archived: true });
    expect((await getJson<{ listings: unknown[] }>("/api/listings")).listings).toHaveLength(0);
    expect((await getJson<{ listings: unknown[] }>("/api/listings?archived=true")).listings).toHaveLength(1);
  });

  it("distinguishes corrections, exposes safe copy-only preparation, and has no send action", async () => {
    const corrected = await mutate(`/api/listings/${listingId}/corrections`, "POST", {
      field: "mileageKm", value: 79000, reason: "Photo shows odometer", proposeRule: true
    });
    expect(corrected.listing).toMatchObject({
      normalizedFacts: { mileageKm: 80000 },
      effectiveFacts: { mileageKm: 79000 },
      corrections: [{ field: "mileageKm", value: 79000, proposal: { status: "pending" } }]
    });
    expect(corrected.listing.sellerMessage).toContain("still available");
    expect(corrected.listing.suggestedQuestions).toContain(
      "Can I inspect and test-drive it before making any commitment?"
    );
    expect(corrected.listing.original.title).toContain("<script>");
    const noSend = await fetch(`${baseUrl}/api/listings/${listingId}/send-message`, { method: "POST" });
    expect(noSend.status).toBe(404);
  });

  it("captures a full description from the controlled listing detail page", async () => {
    const captured = await mutate(`/api/listings/${listingId}/description`, "POST", undefined);
    expect(captured.listing.original.description).toBe("Particular, caixa manual, revisão feita.");
    expect(captured.listing.effectiveFacts.original.description)
      .toBe("Particular, caixa manual, revisão feita.");
    expect(captured.listing.detailFacts).toMatchObject({
      mileage: { descriptionKm: null, cardKm: 80_000, selectedKm: 80_000, source: "card", conflict: false }
    });
  });

  async function getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    return response.json() as Promise<T>;
  }

  async function mutate(path: string, method: string, body?: unknown): Promise<any> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    expect(response.status).toBe(200);
    return response.json();
  }
});
