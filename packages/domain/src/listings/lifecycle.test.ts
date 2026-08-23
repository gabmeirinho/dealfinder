import { describe, expect, it } from "vitest";

import {
  assessPriceChange,
  createListingLifecycle,
  expireListing,
  missListing,
  observeListing,
  sellListing
} from "./lifecycle.js";

describe("listing lifecycle", () => {
  it("moves through three misses and 24-hour inactivity deterministically", () => {
    let state = createListingLifecycle("2026-08-23T09:00:00.000Z");
    state = missListing(state, "2026-08-23T10:00:00.000Z");
    state = missListing(state, "2026-08-23T11:00:00.000Z");
    expect(state).toMatchObject({ availability: "active", consecutiveMisses: 2 });

    state = missListing(state, "2026-08-23T12:00:00.000Z");
    expect(state).toMatchObject({
      availability: "possibly_unavailable",
      consecutiveMisses: 3,
      possiblyUnavailableAt: "2026-08-23T12:00:00.000Z"
    });
    expect(expireListing(state, "2026-08-24T08:59:59.999Z").availability)
      .toBe("possibly_unavailable");
    expect(expireListing(state, "2026-08-24T09:00:00.000Z")).toMatchObject({
      availability: "inactive",
      inactiveAt: "2026-08-24T09:00:00.000Z"
    });
  });

  it("silently restores a disappeared listing when observed again", () => {
    let state = createListingLifecycle("2026-08-23T09:00:00.000Z");
    for (const time of ["10:00", "11:00", "12:00"]) {
      state = missListing(state, `2026-08-23T${time}:00.000Z`);
    }
    state = expireListing(state, "2026-08-24T09:00:00.000Z");

    expect(observeListing(state, "2026-08-24T10:00:00.000Z")).toMatchObject({
      availability: "active",
      consecutiveMisses: 0,
      lastSeenAt: "2026-08-24T10:00:00.000Z",
      possiblyUnavailableAt: null,
      inactiveAt: null
    });
  });

  it("never infers that an unavailable listing was sold", () => {
    let state = createListingLifecycle("2026-08-23T09:00:00.000Z");
    for (const time of ["10:00", "11:00", "12:00"]) {
      state = missListing(state, `2026-08-23T${time}:00.000Z`);
    }
    state = expireListing(state, "2026-08-24T09:00:00.000Z");
    expect(state.availability).toBe("inactive");

    const sold = sellListing(state, "2026-08-24T10:00:00.000Z", "user");
    expect(observeListing(sold, "2026-08-24T11:00:00.000Z")).toMatchObject({
      availability: "sold",
      soldReason: "user"
    });
  });

  it("marks threshold drops and every tracked-listing change as meaningful", () => {
    expect(assessPriceChange(1_000_000, 990_001)).toMatchObject({
      changed: true,
      meaningful: false,
      alertThresholdCents: 10_000
    });
    expect(assessPriceChange(1_000_000, 990_000)).toMatchObject({
      direction: "decrease",
      meaningful: true
    });
    expect(assessPriceChange(2_000_000, 1_980_000)).toMatchObject({
      alertThresholdCents: 20_000,
      meaningful: true
    });
    expect(assessPriceChange(1_000_000, 1_000_001, "shortlisted")).toMatchObject({
      direction: "increase",
      meaningful: true
    });
    expect(assessPriceChange(1_000_000, 1_000_000, "contacted").meaningful).toBe(false);
  });
});
