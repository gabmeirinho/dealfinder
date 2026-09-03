import { describe, expect, it } from "vitest";

import { createEnrichmentInput, parseVehicleEnrichmentJson, validateVehicleEnrichment } from "./index.js";
import { normalizeVehicleFacts } from "../normalization/index.js";

const valid = {
  schemaVersion: 1,
  vehicle: {
    make: "BMW", model: "320d", variant: "M Sport", year: 2020,
    mileageKm: 79_500, fuel: "diesel", transmission: "automatic", powerHp: 190
  },
  price: { amountCents: 2_490_000, interpretation: "full_price" },
  sellerType: "dealer",
  indicators: { financing: true, monthlyPayment: false, deposit: false, damaged: false, imported: false },
  uncertainties: []
};

describe("vehicle enrichment contract", () => {
  it("accepts only the complete schema", () => {
    expect(parseVehicleEnrichmentJson(JSON.stringify(valid))).toEqual(valid);
  });

  it.each([
    ["extra root field", { ...valid, explanation: "trust me" }],
    ["missing nested field", { ...valid, price: { amountCents: 100 } }],
    ["unsupported enum", { ...valid, sellerType: "broker" }],
    ["free-form uncertainty", { ...valid, uncertainties: ["call the seller"] }],
    ["contact in vehicle text", { ...valid, vehicle: { ...valid.vehicle, variant: "call +351 912 345 678" } }]
  ])("rejects %s", (_label, candidate) => {
    expect(() => validateVehicleEnrichment(candidate)).toThrow();
  });

  it("does not parse prose or partial JSON", () => {
    expect(() => parseVehicleEnrichmentJson("BMW 320d, 2020")).toThrow("not valid JSON");
    expect(() => parseVehicleEnrichmentJson('{"schemaVersion":1}')).toThrow("missing or unexpected");
  });

  it("builds a provider input containing only listing text and normalized facts", () => {
    const input = createEnrichmentInput(normalizeVehicleFacts({
      title: "BMW 320d M Sport 2020",
      description: "79 500 km, diesel, caixa automática",
      displayedPrice: "24 900 €",
      cardFacts: ["190 cv"],
      referenceYear: 2026,
      seller: { type: "dealer", rating: 4.9, ratingCount: 300, inventorySize: 60 }
    }));

    expect(Object.keys(input)).toEqual(["title", "description", "facts"]);
    expect(Object.keys(input.facts)).toEqual([
      "priceCents", "year", "mileageKm", "make", "model", "variant", "fuel",
      "transmission", "powerHp", "sellerType", "indicators"
    ]);
    expect(JSON.stringify(input)).not.toMatch(/rating|inventory|evidence|displayedPrice|cardFacts|contact|cookie|url/i);
  });

  it("keeps allowlisted mileage provenance available to the provider", () => {
    const input = createEnrichmentInput(
      normalizeVehicleFacts({
        title: "Volkswagen Golf 2009",
        description: "287.000 km",
        displayedPrice: "4 300 €",
        cardFacts: [],
        referenceYear: 2026,
        structuredFacts: { mileageKm: 297_000 }
      }),
      {
        mileageKm: {
          structuredKm: 297_000,
          descriptionKm: 287_000,
          cardKm: null,
          selectedKm: 297_000,
          source: "facebook_structured",
          conflict: true
        }
      }
    );
    expect(input.sourceFacts?.mileageKm).toEqual({
      structuredKm: 297_000,
      descriptionKm: 287_000,
      cardKm: null,
      selectedKm: 297_000,
      source: "facebook_structured",
      conflict: true
    });
  });
});
