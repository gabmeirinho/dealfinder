import { describe, expect, it } from "vitest";

import {
  createDuplicateTextTokens,
  createImageDifferenceHash,
  groupProbableDuplicates,
  imageHashSimilarity,
  type DuplicateCandidateFingerprint
} from "./index.js";

describe("duplicate fingerprints and grouping", () => {
  it("creates a stable perceptual difference hash from greyscale pixels", () => {
    const descending = Uint8Array.from({ length: 72 }, (_, index) => 255 - (index % 9) * 20);
    const almostSame = Uint8Array.from(descending);
    almostSame[1] = 255;
    const first = createImageDifferenceHash(descending);
    const second = createImageDifferenceHash(almostSame);

    expect(first).toBe("ffffffffffffffff");
    expect(second).toMatch(/^[0-9a-f]{16}$/u);
    expect(imageHashSimilarity(first, second)).toBeGreaterThan(0.95);
  });

  it("groups obvious reposts with corroborated vehicle and image evidence", () => {
    const groups = groupProbableDuplicates([
      candidate(1, { imageDifferenceHash: "ffffffffffffffff" }),
      candidate(2, { imageDifferenceHash: "fffffffffffffffe" })
    ]);

    expect(groups).toEqual([expect.objectContaining({
      memberListingIds: [1, 2],
      confidence: "high",
      explanation: expect.stringContaining("no records were merged"),
      pairEvidence: [expect.objectContaining({
        leftListingId: 1,
        rightListingId: 2,
        confidence: "high",
        imageSimilarity: 0.984
      })]
    })]);
  });

  it("groups matching long-form repost text when no image is available", () => {
    const text = "Immaculate service history single owner navigation leather automatic diesel";
    const groups = groupProbableDuplicates([
      candidate(1, { textTokens: createDuplicateTextTokens(text), imageDifferenceHash: null }),
      candidate(2, { textTokens: createDuplicateTextTokens(`${text} warranty`), imageDifferenceHash: null })
    ]);

    expect(groups[0]).toMatchObject({ memberListingIds: [1, 2], confidence: "high" });
  });

  it("leaves ambiguous same-model cars separate without corroboration", () => {
    expect(groupProbableDuplicates([
      candidate(1, { textTokens: ["bmw", "320d", "2020"], imageDifferenceHash: null }),
      candidate(2, { textTokens: ["bmw", "320d", "2020"], imageDifferenceHash: null })
    ])).toEqual([]);
  });

  it("never groups a materially different vehicle from image similarity alone", () => {
    expect(groupProbableDuplicates([
      candidate(1, { imageDifferenceHash: "ffffffffffffffff" }),
      candidate(2, {
        imageDifferenceHash: "ffffffffffffffff",
        vehicle: { ...vehicle(), make: "audi", model: "a4" }
      })
    ])).toEqual([]);
  });

  it("normalizes text without retaining punctuation or duplicate tokens", () => {
    expect(createDuplicateTextTokens("Único dono, único dono! BMW 320d com histórico completo."))
      .toEqual(["320d", "bmw", "completo", "dono", "historico", "unico"]);
  });
});

function candidate(
  listingId: number,
  overrides: Partial<DuplicateCandidateFingerprint> = {}
): DuplicateCandidateFingerprint {
  return {
    listingId,
    textTokens: ["320d", "automatic", "diesel", "history", "leather", "navigation"],
    vehicle: vehicle(),
    imageDifferenceHash: null,
    ...overrides
  };
}

function vehicle() {
  return {
    make: "bmw",
    model: "320d",
    variant: "m sport",
    year: 2020,
    mileageKm: 80_000,
    fuel: "diesel" as const,
    transmission: "automatic" as const
  };
}
