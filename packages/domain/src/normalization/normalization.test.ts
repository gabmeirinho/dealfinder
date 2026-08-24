import { describe, expect, it } from "vitest";

import englishFixture from "./fixtures/english-financing-trap.json" with { type: "json" };
import portugueseFixture from "./fixtures/portuguese-vehicle.json" with { type: "json" };
import { applyFactCorrections, applyReusableRules } from "./corrections.js";
import { evaluateVehicleMatch } from "./matching.js";
import { normalizeEuroPrice, normalizeVehicleFacts } from "./normalize.js";
import type { NormalizeVehicleInput } from "./types.js";
import { createEmptySearchCriteria } from "../searches/index.js";

describe("vehicle normalization", () => {
  it("normalizes Portuguese vehicle formats and retains original text", () => {
    const facts = normalizeVehicleFacts(portugueseFixture as NormalizeVehicleInput);

    expect(facts).toMatchObject({
      priceCents: 1_495_000,
      year: 2018,
      mileageKm: 128_000,
      make: "Volkswagen",
      model: "Golf",
      variant: "1.6 TDI",
      fuel: "diesel",
      transmission: "manual",
      powerHp: 110,
      seller: { type: "private" },
      indicators: { imported: true }
    });
    expect(facts.original).toEqual({
      title: portugueseFixture.title,
      description: portugueseFixture.description,
      displayedPrice: portugueseFixture.displayedPrice,
      cardFacts: portugueseFixture.cardFacts
    });
    expect(facts.evidence.mileageKm).toEqual(["128.000 km"]);
  });

  it("normalizes English units and detects financing framing", () => {
    const facts = normalizeVehicleFacts(englishFixture as NormalizeVehicleInput);

    expect(facts).toMatchObject({
      priceCents: 39_900,
      year: 2020,
      mileageKm: 79_502,
      make: "BMW",
      model: "320d",
      variant: "M Sport",
      fuel: "diesel",
      transmission: "automatic",
      powerHp: 188,
      seller: { type: "dealer" },
      indicators: { financing: true, monthlyPayment: true, deposit: true }
    });
  });

  it("normalizes common EUR punctuation conservatively", () => {
    expect(normalizeEuroPrice("€12.345,67")).toBe(1_234_567);
    expect(normalizeEuroPrice("12,345.67 €")).toBe(1_234_567);
    expect(normalizeEuroPrice("preço sob consulta")).toBeNull();
    expect(normalizeEuroPrice("399 USD")).toBeNull();
  });

  it("applies hard filters and reports soft preference contributions", () => {
    const facts = normalizeVehicleFacts({
      ...portugueseFixture,
      description: `${portugueseFixture.description} Histórico de manutenção completo.`
    } as NormalizeVehicleInput);
    const criteria = createEmptySearchCriteria();
    criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    criteria.minimumYear = { value: 2019, strength: "hard" };
    criteria.requiredKeywords = { value: ["histórico de manutenção"], strength: "hard" };
    criteria.excludedKeywords = { value: ["importada"], strength: "hard" };
    criteria.transmissions = { value: ["manual"], strength: "soft" };
    criteria.sellerPreference = { value: "dealer", strength: "soft" };

    const result = evaluateVehicleMatch(facts, criteria);
    expect(result.eligible).toBe(false);
    expect(result.hardFailures.map((failure) => failure.criterion))
      .toEqual(["minimumYear", "excludedKeywords"]);
    expect(result.softContributions).toEqual([
      expect.objectContaining({ criterion: "transmissions", matched: true }),
      expect.objectContaining({ criterion: "sellerPreference", matched: false })
    ]);
  });

  it("keeps corrections local and reusable rules explicit", () => {
    const facts = normalizeVehicleFacts(portugueseFixture as NormalizeVehicleInput);
    const corrected = applyFactCorrections(facts, [{ field: "mileageKm", value: 118_000 }]);
    expect(corrected.mileageKm).toBe(118_000);
    expect(corrected.original).toEqual(facts.original);

    expect(applyReusableRules(facts, [{
      field: "make",
      sourceValue: "Volkswagen",
      value: "VW"
    }]).make).toBe("VW");
    expect(facts.make).toBe("Volkswagen");
  });

  it("accepts coarse seller metrics but rejects seller contact data", () => {
    const facts = normalizeVehicleFacts({
      ...portugueseFixture,
      seller: { type: "dealer", rating: 4.6, ratingCount: 81, inventorySize: 24 }
    } as NormalizeVehicleInput);
    expect(facts.seller).toEqual({
      type: "dealer",
      rating: 4.6,
      ratingCount: 81,
      inventorySize: 24
    });
    expect(Object.keys(facts.seller)).toEqual(["type", "rating", "ratingCount", "inventorySize"]);

    expect(() => normalizeVehicleFacts({
      ...portugueseFixture,
      description: "Contact seller@example.invalid for details"
    } as NormalizeVehicleInput)).toThrow("Seller identity or contact data is not accepted");
    expect(() => normalizeVehicleFacts({
      ...portugueseFixture,
      description: "Ligue +351 912 345 678"
    } as NormalizeVehicleInput)).toThrow("Seller identity or contact data is not accepted");
  });
});
