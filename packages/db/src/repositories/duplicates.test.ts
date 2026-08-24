import { afterEach, describe, expect, it } from "vitest";

import { createVehicleSearchDraft, type ProbableDuplicateGroup } from "@dealfinder/domain";

import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

const AT = "2026-08-23T12:00:00.000Z";

describe("duplicates repository", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(() => testDatabase?.cleanup());

  it("stores privacy-limited fingerprints without retaining text tokens", () => {
    testDatabase = createTestDatabase();
    const listingId = createListings(testDatabase, 1).listingIds[0]!;
    const stored = testDatabase.connection.duplicates.saveFingerprint(
      listingId,
      ["automatic", "diesel", "history"],
      {
        make: "bmw", model: "320d", variant: "m sport", year: 2020,
        mileageKm: 80_000, fuel: "diesel", transmission: "automatic"
      },
      "ffffffffffffffff",
      AT
    );

    expect(stored).toMatchObject({
      listingId,
      textTokenCount: 3,
      textSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      imageDifferenceHash: "ffffffffffffffff"
    });
    const row = testDatabase.connection.database.prepare(`
      SELECT * FROM listing_fingerprints WHERE listing_id = ?
    `).get(listingId) as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain("history");
  });

  it("replaces groups without deleting or merging original listing evidence", () => {
    testDatabase = createTestDatabase();
    const setup = createListings(testDatabase, 3);
    const repository = testDatabase.connection.duplicates;
    const first = repository.replaceGroups([group(setup.listingIds[0]!, setup.listingIds[1]!)], AT)[0]!;

    expect(first.members.map(({ sourceListingId }) => sourceListingId)).toEqual([
      "100000000000001", "100000000000002"
    ]);
    expect(first.members[0]?.listingUrl).toContain("100000000000001");
    expect(first.explanation).toContain("no records were merged");
    const stable = repository.replaceGroups(
      [group(setup.listingIds[0]!, setup.listingIds[1]!)],
      "2026-08-23T12:05:00.000Z"
    )[0]!;
    expect(stable.id).toBe(first.id);
    expect(stable.createdAt).toBe(first.createdAt);
    expect(stable.updatedAt).not.toBe(first.updatedAt);

    const changed = repository.replaceGroups(
      [group(setup.listingIds[1]!, setup.listingIds[2]!)],
      "2026-08-23T12:10:00.000Z"
    )[0]!;
    expect(changed.members.map(({ listingId }) => listingId)).toEqual([
      setup.listingIds[1], setup.listingIds[2]
    ]);
    expect(setup.listingIds.map((id) => testDatabase!.connection.listings.get(id)?.sourceListingId))
      .toEqual(["100000000000001", "100000000000002", "100000000000003"]);
  });

  it("tracks one cached thumbnail and deterministic expiry metadata", () => {
    testDatabase = createTestDatabase();
    const [listingId] = createListings(testDatabase, 1).listingIds;
    const repository = testDatabase.connection.duplicates;
    repository.saveThumbnail({
      listingId: listingId!,
      sourceUrlSha256: "a".repeat(64),
      relativePath: `${listingId}.webp`,
      byteSize: 1234,
      width: 512,
      height: 320,
      cachedAt: AT,
      expiresAt: "2026-09-22T12:00:00.000Z"
    });

    expect(repository.listDueThumbnails("2026-09-22T11:59:59.000Z")).toEqual([]);
    expect(repository.listDueThumbnails("2026-09-22T12:00:00.000Z")).toEqual([
      expect.objectContaining({ listingId, relativePath: `${listingId}.webp` })
    ]);
    expect(repository.deleteThumbnail(listingId!)).toBe(true);
    expect(repository.getThumbnail(listingId!)).toBeUndefined();
  });
});

function group(left: number, right: number): ProbableDuplicateGroup {
  return {
    memberListingIds: [left, right],
    confidence: "high",
    explanation: "2 original listings grouped from 1 corroborated pair; no records were merged",
    pairEvidence: [{
      leftListingId: Math.min(left, right),
      rightListingId: Math.max(left, right),
      confidence: "high",
      vehicleSimilarity: 1,
      textSimilarity: 0.9,
      imageSimilarity: 0.98,
      explanation: "Vehicle 100%, text 90%, image 98%; high probable duplicate"
    }]
  };
}

function createListings(testDatabase: TestDatabase, count: number) {
  const database = testDatabase.connection;
  const draft = createVehicleSearchDraft("BMW duplicates");
  draft.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
  const search = database.searches.create(draft);
  const listingIds = Array.from({ length: count }, (_, index) => {
    const sourceListingId = String(100000000000001 + index);
    const observedAt = new Date(Date.parse(AT) + index * 1000).toISOString();
    const raw = database.rawCandidates.saveObservation({
      searchId: search.id,
      observedAt,
      candidate: {
        source: "facebook",
        sourceListingId,
        url: `https://www.facebook.com/marketplace/item/${sourceListingId}/`,
        title: "BMW 320d M Sport 2020",
        displayedPrice: "22 000 €",
        location: "Lisboa",
        thumbnailUrl: null,
        rawCardFacts: ["80 000 km"]
      }
    });
    return database.listings.ingestObservation({
      rawCandidateId: raw.candidate.id,
      searchId: search.id,
      observedAt,
      initialScan: false,
      source: "facebook",
      sourceListingId,
      listingUrl: raw.candidate.listingUrl,
      title: raw.observation.title,
      displayedPrice: raw.observation.displayedPrice,
      priceCents: 2_200_000
    }).listing.id;
  });
  return { searchId: search.id, listingIds };
}
