import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import { ListingIngestionService } from "../listings/index.js";
import { ThumbnailStorage } from "./thumbnail-storage.js";

describe("duplicate thumbnail storage", () => {
  let database: DatabaseConnection | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    database?.close();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("caches one bounded metadata-free WebP and reuses its perceptual fingerprint", async () => {
    ({ database, directory } = await setup());
    const listingId = seedListing(database);
    const image = await syntheticImage();
    const fetchImage = vi.fn(async () => new Response(image, {
      headers: { "content-type": "image/png", "content-length": String(image.byteLength) }
    })) as unknown as typeof fetch;
    const storage = new ThumbnailStorage({
      database: () => database as DatabaseConnection,
      directory,
      fetch: fetchImage,
      allowedHosts: ["images.example.test"]
    });

    const first = await storage.cache(listingId, "https://images.example.test/vehicles/synthetic.png");
    database.duplicates.saveFingerprint(
      listingId,
      ["bmw", "repost"],
      { make: "bmw", model: "320d", variant: null, year: 2020, mileageKm: 80_000, fuel: "diesel", transmission: "automatic" },
      first.imageDifferenceHash,
      "2026-08-23T12:00:00.000Z"
    );
    const second = await storage.cache(listingId, "https://images.example.test/vehicles/synthetic.png");

    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(second.imageDifferenceHash).toBe(first.imageDifferenceHash);
    expect(first.imageDifferenceHash).toMatch(/^[0-9a-f]{16}$/u);
    expect(first.metadata.relativePath).toBe(`${listingId}.webp`);
    const metadata = await sharp(await readFile(join(directory, `${listingId}.webp`))).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 512, height: 256 });
    expect(metadata.exif).toBeUndefined();
    expect(JSON.stringify(database.duplicates.getThumbnail(listingId))).not.toContain("synthetic.png");
  });

  it("expires the cached file 30 days after a listing becomes inactive", async () => {
    ({ database, directory } = await setup());
    const listingId = seedListing(database);
    const image = await syntheticImage();
    const storage = new ThumbnailStorage({
      database: () => database as DatabaseConnection,
      directory,
      fetch: (async () => new Response(image, { headers: { "content-type": "image/png" } })) as typeof fetch,
      allowedHosts: ["images.example.test"]
    });
    await storage.cache(listingId, "https://images.example.test/vehicles/retained.png");
    storage.syncRetention(listingId, "2026-07-01T00:00:00.000Z");

    expect(await storage.cleanupExpired("2026-07-30T23:59:59.999Z")).toBe(0);
    expect(await storage.cleanupExpired("2026-07-31T00:00:00.000Z")).toBe(1);
    expect(database.duplicates.getThumbnail(listingId)).toBeUndefined();
    await expect(readFile(join(directory, `${listingId}.webp`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects untrusted hosts and non-raster responses without persisting them", async () => {
    ({ database, directory } = await setup());
    const listingId = seedListing(database);
    const storage = new ThumbnailStorage({
      database: () => database as DatabaseConnection,
      directory,
      fetch: (async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })) as typeof fetch,
      allowedHosts: ["images.example.test"]
    });

    await expect(storage.cache(listingId, "https://attacker.invalid/image.png"))
      .rejects.toThrow("not allowed");
    await expect(storage.cache(listingId, "https://images.example.test/image.svg"))
      .rejects.toThrow("supported raster image");
    expect(database.duplicates.getThumbnail(listingId)).toBeUndefined();
  });
});

async function setup(): Promise<{ database: DatabaseConnection; directory: string }> {
  return {
    database: openDatabase({ filename: ":memory:" }),
    directory: await mkdtemp(join(tmpdir(), "dealfinder-thumbnails-"))
  };
}

function seedListing(database: DatabaseConnection): number {
  const draft = createVehicleSearchDraft("Synthetic vehicles");
  draft.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
  const search = database.searches.create(draft);
  return new ListingIngestionService(() => database).ingestScan({
    searchId: search.id,
    observedAt: "2026-08-23T10:00:00.000Z",
    initialScan: false,
    completeSnapshot: false,
    candidates: [{
      source: "facebook",
      sourceListingId: "100000000000001",
      url: "https://www.facebook.com/marketplace/item/100000000000001/",
      title: "Synthetic BMW 320d",
      description: "Generated test vehicle description",
      displayedPrice: "20 000 €",
      location: "Lisboa",
      thumbnailUrl: "https://images.example.test/vehicles/synthetic.png",
      rawCardFacts: ["80 000 km"],
      seller: { type: "private" }
    }]
  }).listings[0]!.id;
}

async function syntheticImage(): Promise<Buffer> {
  const pixels = Buffer.alloc(640 * 320 * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = (offset / 3) % 256;
    pixels[offset + 1] = Math.floor(offset / (640 * 3)) % 256;
    pixels[offset + 2] = 128;
  }
  return sharp(pixels, { raw: { width: 640, height: 320, channels: 3 } }).png().toBuffer();
}
