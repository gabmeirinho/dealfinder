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

  it("does not mistake a crossed-out previous price for the title", () => {
    const result = parseFacebookResultPage(`
      <main data-dealfinder-results-contract="1">
        <article data-dealfinder-card="marketplace-item">
          <a href="/marketplace/item/100000000000010/">
            <span>16 300 €</span><span>21 000 €</span>
            <span>Volkswagen Golf 6 GTI DSG</span><span>Lisboa</span>
          </a>
        </article>
      </main>
    `);

    expect(result.candidates[0]).toMatchObject({
      displayedPrice: "16 300 €",
      title: "Volkswagen Golf 6 GTI DSG",
      location: "Lisboa"
    });
  });

  it("captures an optional card description and keeps it separate from card facts", () => {
    const result = parseFacebookResultPage(`
      <main data-dealfinder-results-contract="1">
        <article data-dealfinder-card="marketplace-item">
          <a href="/marketplace/item/100000000000011/">
            <span data-dealfinder-field="price">12 500 €</span>
            <span data-dealfinder-field="title">Volkswagen Golf 2018</span>
            <span data-dealfinder-field="description">Particular, caixa manual, histórico completo.</span>
            <span data-dealfinder-field="location">Lisboa</span>
            <span data-dealfinder-field="fact">120 000 km</span>
          </a>
        </article>
      </main>
    `);

    expect(result.candidates).toEqual([expect.objectContaining({
      description: "Particular, caixa manual, histórico completo.",
      rawCardFacts: ["120 000 km", "12 500 €", "Volkswagen Golf 2018", "Lisboa"]
    })]);
  });

  it("rejects descriptions containing seller contact data", () => {
    const result = parseFacebookResultPage(`
      <main data-dealfinder-results-contract="1">
        <article data-dealfinder-card="marketplace-item">
          <a href="/marketplace/item/100000000000012/">
            <span data-dealfinder-field="title">Volkswagen Golf 2018</span>
            <span data-dealfinder-field="description">Contactar pelo WhatsApp +351 912 345 678.</span>
          </a>
        </article>
      </main>
    `);

    expect(result.candidates).toEqual([]);
    expect(result.rejectedCards[0]).toMatchObject({
      sourceListingId: "100000000000012",
      reasons: ["Seller identity or contact data is not accepted"]
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

  it("rejects cards whose inferred fields exceed persistence bounds", () => {
    const oversizedTitle = "G".repeat(1001);
    const result = parseFacebookResultPage(`
      <main data-dealfinder-results-contract="1">
        <article data-dealfinder-card="marketplace-item">
          <a href="/marketplace/np/item/100000000000008/">
            <span>9 500 €</span><span>${oversizedTitle}</span>
          </a>
        </article>
      </main>
    `);

    expect(result.candidates).toEqual([]);
    expect(result.rejectedCards).toEqual([{
      cardIndex: 0,
      sourceListingId: "100000000000008",
      reasons: ["Listing title exceeds 1000 characters"]
    }]);
  });

  it("rejects contact-bearing cards before persistence", () => {
    const result = parseFacebookResultPage(`
      <main data-dealfinder-results-contract="1">
        <article data-dealfinder-card="marketplace-item">
          <a href="/marketplace/np/item/100000000000009/">
            <span>9 500 €</span><span>Volkswagen Golf — 912 345 678</span>
          </a>
        </article>
      </main>
    `);

    expect(result.candidates).toEqual([]);
    expect(result.rejectedCards[0]).toMatchObject({
      sourceListingId: "100000000000009",
      reasons: ["Seller identity or contact data is not accepted"]
    });
  });

  it("fails closed when the declared layout contract changes", () => {
    expect(() => parseFacebookResultPage(fixture("results-changed-layout.html")))
      .toThrowError(FacebookResultContractError);
    expect(() => parseFacebookResultPage(fixture("results-changed-layout.html")))
      .toThrow("Unsupported Marketplace result contract version: 2");
  });
});
