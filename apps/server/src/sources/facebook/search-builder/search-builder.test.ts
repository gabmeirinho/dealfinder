import { describe, expect, it } from "vitest";

import {
  createVehicleSearchDraft,
  type VehicleSearch,
  type VehicleSearchDraft
} from "@dealfinder/domain";

import { buildFacebookVehicleSearch } from "./index.js";

describe("Facebook vehicle search builder", () => {
  it("builds a distinct query and budget for each explicit model target", () => {
    const urls = ["Golf", "Polo"].map((model, index) => {
      const draft = createVehicleSearchDraft(model);
      draft.criteria.modelTarget = { strength: "hard", value: { make: "Volkswagen", model, variant: null } };
      draft.criteria.priceRange = { strength: "hard", value: { minimumEur: null, maximumEur: 15000 + index * 1000 } };
      return new URL(buildFacebookVehicleSearch(asSearch(draft)).url);
    });
    expect(urls.map((url) => url.searchParams.get("query"))).toEqual(["Volkswagen Golf", "Volkswagen Polo"]);
    expect(urls.map((url) => url.searchParams.get("maxPrice"))).toEqual(["15000", "16000"]);
  });

  it("translates characterized keyword, price, year, and mileage filters", () => {
    const draft = completeDraft();
    const result = buildFacebookVehicleSearch(asSearch(draft));
    const url = new URL(result.url);

    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/marketplace/lisbon/vehicles/");
    expect(url.searchParams.get("query")).toBe("Volkswagen Golf GTE service history");
    expect(url.searchParams.get("minPrice")).toBe("15000");
    expect(url.searchParams.get("maxPrice")).toBe("25000");
    expect(url.searchParams.get("minYear")).toBe("2019");
    expect(url.searchParams.get("maxMileage")).toBe("120000");
    expect(url.searchParams.get("radius")).toBe("150");
    expect(result.supportedFilters).toEqual([
      "criteria.makeKeywords",
      "criteria.modelKeywords",
      "criteria.variantKeywords",
      "criteria.requiredKeywords",
      "criteria.priceRange",
      "criteria.minimumYear",
      "criteria.maximumMileageKm",
      "location"
    ]);
  });

  it("sends radius location and identifies unsupported criteria for post-filtering", () => {
    const result = buildFacebookVehicleSearch(asSearch(completeDraft()));

    expect(result.postFilters.map(({ field }) => field)).toEqual([
      "fuels",
      "transmissions",
      "minimumPowerHp",
      "sellerPreference",
      "excludedKeywords"
    ]);
    expect(result.postFilters[0]?.label).toBe("Fuel: plug-in hybrid");
  });

  it("omits absent optional URL parameters without inventing defaults", () => {
    const draft = createVehicleSearchDraft("Simple Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const result = buildFacebookVehicleSearch(asSearch(draft));
    const url = new URL(result.url);

    expect(url.pathname).toBe("/marketplace/lisbon/vehicles/");
    expect([...url.searchParams.keys()]).toEqual(["query", "radius"]);
    expect(result.postFilters).toHaveLength(0);
  });

  it("keeps nationwide location as an explicit browser check", () => {
    const draft = createVehicleSearchDraft("Portugal Golf");
    draft.location = { mode: "nationwide", origin: null, radiusKm: null };
    const result = buildFacebookVehicleSearch(asSearch(draft));
    const url = new URL(result.url);

    expect(url.pathname).toBe("/marketplace/category/vehicles/");
    expect(url.searchParams.has("radius")).toBe(false);
    expect(result.postFilters[0]?.field).toBe("location");
  });
});

function completeDraft(): VehicleSearchDraft {
  const draft = createVehicleSearchDraft("Golf GTE");
  draft.criteria = {
    makeKeywords: { value: ["Volkswagen"], strength: "hard" },
    modelKeywords: { value: ["Golf"], strength: "hard" },
    variantKeywords: { value: ["GTE"], strength: "soft" },
    priceRange: {
      value: { minimumEur: 15_000, maximumEur: 25_000 },
      strength: "hard"
    },
    minimumYear: { value: 2019, strength: "hard" },
    maximumMileageKm: { value: 120_000, strength: "soft" },
    fuels: { value: ["plug_in_hybrid"], strength: "hard" },
    transmissions: { value: ["automatic"], strength: "soft" },
    minimumPowerHp: { value: 200, strength: "soft" },
    sellerPreference: { value: "private", strength: "soft" },
    requiredKeywords: { value: ["service history"], strength: "hard" },
    excludedKeywords: { value: ["damaged"], strength: "hard" }
  };
  return draft;
}

function asSearch(draft: VehicleSearchDraft): VehicleSearch {
  return {
    ...draft,
    location: draft.location.mode === "nationwide"
      ? { mode: "nationwide", origin: null, radiusKm: null }
      : {
        mode: "radius",
        origin: draft.location.origin ?? "Lisbon, Portugal",
        radiusKm: 150
      },
    id: "search-1",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z"
  };
}
