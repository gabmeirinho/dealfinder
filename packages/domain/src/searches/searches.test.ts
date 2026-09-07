import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEARCH_ORIGIN,
  DEFAULT_SEARCH_RADIUS_KM,
  SEARCH_CURRENCY,
  SEARCH_DISTANCE_UNIT,
  SEARCH_TIMEZONE,
  SearchValidationError,
  assertValidVehicleSearch,
  createVehicleSearchDraft,
  validateVehicleSearch
} from "./index.js";

describe("saved search rules", () => {
  it("uses the confirmed Lisbon, radius, unit, and locale defaults", () => {
    const draft = createVehicleSearchDraft("Family car");

    expect(draft.location).toEqual({
      mode: "radius",
      origin: DEFAULT_SEARCH_ORIGIN,
      radiusKm: DEFAULT_SEARCH_RADIUS_KM
    });
    expect(draft.location).toEqual({
      mode: "radius",
      origin: "Lisbon, Portugal",
      radiusKm: 150
    });
    expect(draft.criteria.searchScope).toBe("targeted");
    expect(SEARCH_CURRENCY).toBe("EUR");
    expect(SEARCH_DISTANCE_UNIT).toBe("km");
    expect(SEARCH_TIMEZONE).toBe("Europe/Lisbon");
  });

  it("normalizes a complete canonical search while retaining hard and soft rules", () => {
    const draft = createVehicleSearchDraft("  Golf GTE  ");
    draft.criteria = {
      makeKeywords: { value: [" Volkswagen "], strength: "hard" },
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

    expect(assertValidVehicleSearch(draft, 2026)).toMatchObject({
      name: "Golf GTE",
      criteria: {
        makeKeywords: { value: ["Volkswagen"], strength: "hard" },
        variantKeywords: { value: ["GTE"], strength: "soft" },
        maximumMileageKm: { value: 120_000, strength: "soft" }
      }
    });
  });

  it("returns field-level errors for contradictory and incomplete criteria", () => {
    const draft = createVehicleSearchDraft("Broken search");
    draft.criteria.priceRange = {
      value: { minimumEur: 30_000, maximumEur: 20_000 },
      strength: "hard"
    };
    draft.criteria.requiredKeywords = { value: ["manual"], strength: "hard" };
    draft.criteria.excludedKeywords = { value: ["Manual"], strength: "hard" };
    draft.location = {
      mode: "nationwide",
      origin: "Lisbon, Portugal",
      radiusKm: 150
    };

    const result = validateVehicleSearch(draft, 2026);
    expect(result).toEqual({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "criteria.priceRange.maximumEur" }),
        expect.objectContaining({ path: "criteria.excludedKeywords" }),
        expect.objectContaining({ path: "location.origin" }),
        expect.objectContaining({ path: "location.radiusKm" })
      ])
    });
  });

  it("rejects searches without identifying criteria and exposes grouped errors", () => {
    const draft = createVehicleSearchDraft(" ");

    expect(() => assertValidVehicleSearch(draft, 2026)).toThrow(SearchValidationError);
    try {
      assertValidVehicleSearch(draft, 2026);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SearchValidationError);
      expect((error as SearchValidationError).fieldErrors).toMatchObject({
        name: expect.any(Array),
        criteria: expect.any(Array)
      });
    }
  });

  it("treats legacy criteria without a scope as targeted", () => {
    const draft = createVehicleSearchDraft("Legacy search");
    delete draft.criteria.searchScope;

    const result = validateVehicleSearch(draft, 2026);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        path: "criteria",
        message: "must include at least one make, model, variant, or required keyword"
      });
      expect(result.issues.some(({ path }) => path === "criteria.searchScope")).toBe(false);
    }
  });

  it("accepts a bounded broad search without a model target", () => {
    const draft = createVehicleSearchDraft("Any petrol under 6000");
    draft.criteria.searchScope = "broad";
    draft.criteria.fuels = { value: ["petrol"], strength: "hard" };
    draft.criteria.priceRange = {
      value: { minimumEur: null, maximumEur: 6_000 },
      strength: "hard"
    };

    const result = validateVehicleSearch(draft, 2026);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.criteria).toMatchObject({
        searchScope: "broad",
        fuels: { value: ["petrol"], strength: "hard" },
        priceRange: {
          value: { minimumEur: null, maximumEur: 6_000 },
          strength: "hard"
        }
      });
      expect(result.value.criteria.modelTarget).toBeUndefined();
    }
  });

  it("rejects an unbounded broad search with a scope field error", () => {
    const draft = createVehicleSearchDraft("Everything");
    draft.criteria.searchScope = "broad";

    const result = validateVehicleSearch(draft, 2026);

    expect(result).toEqual({
      success: false,
      issues: expect.arrayContaining([
        {
          path: "criteria.searchScope",
          message: expect.stringContaining("broad searches require at least one hard narrowing filter")
        }
      ])
    });
  });

  it.each(["fuels", "maximum mileage", "minimum year", "required keywords"] as const)("accepts a broad search narrowed by %s", (field) => {
    const draft = createVehicleSearchDraft(`Broad by ${field}`);
    draft.criteria.searchScope = "broad";
    if (field === "fuels") draft.criteria.fuels = { value: ["petrol"], strength: "hard" };
    if (field === "maximum mileage") draft.criteria.maximumMileageKm = { value: 120_000, strength: "hard" };
    if (field === "minimum year") draft.criteria.minimumYear = { value: 2020, strength: "hard" };
    if (field === "required keywords") draft.criteria.requiredKeywords = { value: ["service history"], strength: "hard" };

    expect(validateVehicleSearch(draft, 2026).success).toBe(true);
  });

  it("requires broad bounds to be hard constraints", () => {
    const draft = createVehicleSearchDraft("Soft petrol");
    draft.criteria.searchScope = "broad";
    draft.criteria.fuels = { value: ["petrol"], strength: "soft" };

    const result = validateVehicleSearch(draft, 2026);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ path }) => path)).toContain("criteria.searchScope");
    }
  });

  it("enforces whole EUR and kilometre values and selectable radii", () => {
    const draft = createVehicleSearchDraft("Invalid units");
    draft.criteria.makeKeywords = { value: ["Volvo"], strength: "hard" };
    draft.criteria.priceRange = {
      value: { minimumEur: 10_000.5, maximumEur: null },
      strength: "hard"
    };
    draft.criteria.maximumMileageKm = { value: 10_000.5, strength: "hard" };
    draft.location.radiusKm = 75;

    const result = validateVehicleSearch(draft, 2026);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ path }) => path)).toEqual(
        expect.arrayContaining([
          "criteria.priceRange.minimumEur",
          "criteria.maximumMileageKm.value",
          "location.radiusKm"
        ])
      );
    }
  });
});
