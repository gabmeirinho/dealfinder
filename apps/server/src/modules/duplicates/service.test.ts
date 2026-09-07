import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import { ListingIngestionService } from "../listings/index.js";
import { DuplicateDetectionService } from "./service.js";
import { ThumbnailStorage } from "./thumbnail-storage.js";

const COMPUTED_AT = "2026-08-23T12:00:00.000Z";

describe("duplicate detection service", () => {
  let database: DatabaseConnection | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    database?.close();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("groups corroborated reposts while retaining originals and uncertain matches", async () => {
    database = openDatabase({ filename: ":memory:" });
    directory = await mkdtemp(join(tmpdir(), "dealfinder-duplicate-service-"));
    const listingIds = seedListings(database);
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = new DuplicateDetectionService({
      database: () => database as DatabaseConnection,
      thumbnails: new ThumbnailStorage({
        database: () => database as DatabaseConnection,
        directory
      }),
      logger
    });

    const groups = await service.recomputeAll(COMPUTED_AT);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map(({ listingId }) => listingId)).toEqual(listingIds.slice(0, 2));
    expect(groups[0]?.members.map(({ listingUrl }) => listingUrl)).toEqual([
      "https://www.facebook.com/marketplace/item/100000000000001/",
      "https://www.standvirtual.com/carros/anuncio/bmw-320d-ID100000000000002.html"
    ]);
    expect(groups[0]?.explanation).toContain("no records were merged");
    expect(database.listings.get(listingIds[2]!)).toBeDefined();
    expect(database.duplicates.getFingerprint(listingIds[0]!)?.textSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(database.duplicates.getFingerprint(listingIds[0]!))).not.toContain("carefully maintained");
  });
});

function seedListings(database: DatabaseConnection): number[] {
  const draft = createVehicleSearchDraft("BMW duplicates");
  draft.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
  const search = database.searches.create(draft);
  const detailedDescription = "Carefully maintained diesel automatic vehicle with service history navigation leather and recent inspection";
  const result = new ListingIngestionService(() => database).ingestScan({
    searchId: search.id,
    observedAt: "2026-08-23T10:00:00.000Z",
    initialScan: false,
    completeSnapshot: false,
    candidates: [0, 1, 2].map((index) => ({
      source: index === 1 ? "standvirtual" as const : "facebook" as const,
      sourceListingId: String(100000000000001 + index),
      url: index === 1
        ? `https://www.standvirtual.com/carros/anuncio/bmw-320d-ID${100000000000001 + index}.html`
        : `https://www.facebook.com/marketplace/item/${100000000000001 + index}/`,
      title: "BMW 320d 2020",
      description: index < 2 ? detailedDescription : null,
      displayedPrice: "20 000 €",
      location: "Lisboa",
      thumbnailUrl: null,
      rawCardFacts: index < 2 ? ["80 000 km", "M Sport"] : [],
      seller: { type: "private" as const }
    }))
  });
  return result.listings.map(({ id }) => id);
}
