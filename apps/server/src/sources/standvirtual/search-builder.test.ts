import { describe, expect, it } from "vitest";
import { buildStandvirtualModelSearch, buildStandvirtualSearch } from "./search-builder.js";

describe("Standvirtual model search builder", () => {
  it("builds broad petrol budget queries and explicitly uncapped evidence queries", () => {
    const strict = buildStandvirtualSearch({ fuel: "petrol", maximumPriceEur: 6000 });
    expect(strict.url).toBe("https://www.standvirtual.com/carros?search%5Bfilter_enum_fuel_type%5D%5B0%5D=gaz&search%5Bfilter_float_price%3Ato%5D=6000");
    expect(strict).toMatchObject({ searchScope: "broad", pricePolicy: "strict", target: null });
    const evidence = buildStandvirtualSearch({ fuel: "petrol", maximumPriceEur: 6000, pricePolicy: "market_evidence" });
    expect(evidence.url).not.toContain("price");
    expect(evidence.filters.maximumPriceEur).toBeNull();
    expect(buildStandvirtualSearch({ make: "VW" }).standvirtualIds).toEqual({ make: "vw", model: null });
    expect(() => buildStandvirtualSearch({ model: "Golf" })).toThrow("requires a make");
    expect(() => buildStandvirtualSearch({ fuel: "diesel" as "petrol" })).toThrow("petrol");
  });

  it.each([0, -1, 1.5, NaN, Infinity, 10_000_001])("rejects invalid price %s even for evidence queries", (maximumPriceEur) => {
    expect(() => buildStandvirtualSearch({ maximumPriceEur, pricePolicy: "market_evidence" })).toThrow("Maximum price");
  });
  it("builds explicit make and model filters", () => {
    const result = buildStandvirtualModelSearch("BMW", "M2");
    expect(result).toEqual({
      url: "https://www.standvirtual.com/carros?search%5Bfilter_enum_make%5D%5B0%5D=bmw&search%5Bfilter_enum_model%5D%5B0%5D=m2",
      target: { make: "BMW", model: "M2" },
      standvirtualIds: { make: "bmw", model: "m2" },
      filters: { fuel: null, maximumPriceEur: null }
    });
  });

  it("adds petrol and maximum-price filters", () => {
    const result = buildStandvirtualModelSearch("Renault", "Clio", {
      fuel: "petrol",
      maximumPriceEur: 6000
    });
    expect(result.url).toContain("filter_enum_fuel_type%5D%5B0%5D=gaz");
    expect(result.url).toContain("filter_float_price%3Ato%5D=6000");
    expect(result.filters).toEqual({ fuel: "petrol", maximumPriceEur: 6000 });
  });

  it("uses Standvirtual make identifiers and URL-safe model identifiers", () => {
    expect(buildStandvirtualModelSearch("VW", "Golf GTE")).toMatchObject({
      target: { make: "Volkswagen", model: "Golf GTE" },
      standvirtualIds: { make: "vw", model: "golf-gte" }
    });
    expect(buildStandvirtualModelSearch("Citroën", "C4 Cactus").standvirtualIds)
      .toEqual({ make: "citroen", model: "c4-cactus" });
  });

  it("rejects empty, oversized, and non-sluggable targets", () => {
    expect(() => buildStandvirtualModelSearch("", "M2")).toThrow("Make");
    expect(() => buildStandvirtualModelSearch("BMW", " ")).toThrow("Model");
    expect(() => buildStandvirtualModelSearch("BMW", "x".repeat(101))).toThrow("Model");
    expect(() => buildStandvirtualModelSearch("BMW", "🚗")).toThrow("letters or numbers");
    expect(() => buildStandvirtualModelSearch("BMW", "M2", { maximumPriceEur: 1.5 })).toThrow("Maximum price");
  });
});
