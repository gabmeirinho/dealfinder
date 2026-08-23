import { describe, expect, it } from "vitest";

import {
  approximateDistance,
  nationwideDistance,
  normalizeLocality,
  straightLineDistanceKm,
  unknownDistance
} from "./distance.js";

describe("approximate distance", () => {
  it("normalizes Portuguese and English locality labels to stable cache keys", () => {
    expect(normalizeLocality("  Lisboa, Portugal ")).toEqual({
      displayName: "Lisboa",
      cacheKey: "lisboa"
    });
    expect(normalizeLocality("Lisbon, Portugal")?.cacheKey).toBe("lisboa");
    expect(normalizeLocality("Évora")?.cacheKey).toBe("evora");
    expect(normalizeLocality("  ")).toBeNull();
  });

  it("calculates and labels straight-line distance without route claims", () => {
    const lisbon = { latitude: 38.7223, longitude: -9.1393 };
    const setubal = { latitude: 38.5244, longitude: -8.8882 };
    expect(straightLineDistanceKm(lisbon, setubal)).toBeCloseTo(31, 0);

    expect(approximateDistance(lisbon, setubal, 50, {
      provider: "dealfinder-portugal-localities",
      attribution: "Bundled Portuguese locality centroids"
    })).toMatchObject({
      status: "approximate",
      withinConfiguredRadius: true,
      method: "straight_line",
      label: expect.stringMatching(/^≈ \d+\.\d km straight-line$/u)
    });
  });

  it("represents nationwide and unknown distance without excluding a listing", () => {
    expect(nationwideDistance()).toEqual({
      status: "not_applicable",
      approximateKilometres: null,
      withinConfiguredRadius: null,
      method: null,
      label: "Nationwide search · distance not used",
      reason: null,
      attribution: null
    });
    expect(unknownDistance("listing_not_found")).toMatchObject({
      status: "unknown",
      withinConfiguredRadius: null,
      label: "Distance unknown"
    });
  });
});
