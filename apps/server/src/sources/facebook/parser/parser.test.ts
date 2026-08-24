import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FacebookResultContractError,
  parseFacebookResultPage
} from "./index.js";

const fixture = (name: string): string => readFileSync(
  fileURLToPath(new URL(`../../../../test/fixtures/facebook/${name}`, import.meta.url)),
  "utf8"
);

describe("Facebook Marketplace result parser", () => {
  it("extracts Portuguese and English result cards", () => {
    const result = parseFacebookResultPage(fixture("results-v1.html"));

    expect(result.contractVersion).toBe(1);
    expect(result.candidates).toEqual([
      {
        source: "facebook",
        sourceListingId: "100000000000001",
        url: "https://www.facebook.com/marketplace/item/100000000000001/",
        title: "Volkswagen Golf 1.6 TDI 2018",
        displayedPrice: "14 950 €",
        location: "Lisboa",
        thumbnailUrl: "https://example.invalid/vehicle-thumbnail-1.jpg",
        rawCardFacts: ["128 000 km", "Diesel", "14 950 €", "Volkswagen Golf 1.6 TDI 2018", "Lisboa"]
      },
      {
        source: "facebook",
        sourceListingId: "100000000000002",
        url: "https://www.facebook.com/marketplace/item/100000000000002/",
        title: "Volvo V40 D2 2017",
        displayedPrice: "Contact seller",
        location: "Setúbal",
        thumbnailUrl: "https://example.invalid/vehicle-thumbnail-2.jpg",
        rawCardFacts: ["92,000 km", "Manual", "Contact seller", "Volvo V40 D2 2017", "Setúbal"]
      }
    ]);
    expect(result.rejectedCards).toEqual([]);
  });

  it("keeps placeholder prices and removes duplicate listing IDs", () => {
    const result = parseFacebookResultPage(fixture("results-duplicates-v1.html"));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      sourceListingId: "100000000000003",
      displayedPrice: "Grátis"
    });
  });

  it("extracts cards using Facebook's np item route", () => {
    const result = parseFacebookResultPage(fixture("results-np-v1.html"));

    expect(result.candidates).toEqual([
      expect.objectContaining({
        sourceListingId: "100000000000007",
        url: "https://www.facebook.com/marketplace/item/100000000000007/",
        title: "Volkswagen Golf 1.6 TDI 2017"
      })
    ]);
    expect(result.rejectedCards).toEqual([]);
  });

  it("rejects corrupt cards without committing partial candidates", () => {
    const result = parseFacebookResultPage(fixture("results-missing-fields-v1.html"));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.displayedPrice).toBeNull();
    expect(result.candidates[0]?.location).toBeNull();
    expect(result.rejectedCards).toEqual([
      {
        cardIndex: 1,
        sourceListingId: "100000000000005",
        reasons: ["A non-empty listing title is required"]
      },
      {
        cardIndex: 2,
        sourceListingId: null,
        reasons: ["A canonical Marketplace item URL is required"]
      }
    ]);
  });

  it("fails closed when the declared layout contract changes", () => {
    expect(() => parseFacebookResultPage(fixture("results-changed-layout.html")))
      .toThrowError(FacebookResultContractError);
    expect(() => parseFacebookResultPage(fixture("results-changed-layout.html")))
      .toThrow("Unsupported Marketplace result contract version: 2");
  });
});
