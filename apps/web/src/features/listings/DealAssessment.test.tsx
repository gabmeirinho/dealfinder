// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { DealScore } from "@dealfinder/domain";
import { DealAssessment } from "./DealAssessment.js";

afterEach(cleanup);

const assessment: DealScore = {
  version: 2,
  marketValue: { status: "insufficient_data", medianPriceCents: null, askingPriceRange: null,
    discountPercent: null, position: null, comparableCount: 1, explanation: "At least 5 comparable vehicles are needed." },
  personalFit: { status: "assessed", percent: 100, matchedCount: 1, missedCount: 0, unknownCount: 0,
    preferences: [{ criterion: "sellerPreference", matched: true, explanation: "Dealer preferred" }],
    distance: null, explanation: "1 matched, 0 missed, 0 unknown." },
  confidence: { level: "low", knownFactCount: 8, totalFactCount: 9, comparableCount: 1,
    recentComparableCount: 1, priceSpreadPercent: null, reasons: ["Only one comparable vehicle is available."] }
};

function record(score = assessment, searchId = "golf", searchName = "Diesel Golfs") {
  return { searchId, searchName, score };
}

describe("independent assessment presentation", () => {
  it("shows strong fit beside insufficient market evidence without a blended score", async () => {
    render(<DealAssessment listing={{ scores: [record()], matchStatus: "matches" }} />);
    expect(screen.getByRole("heading", { name: "Market value" })).toBeTruthy();
    expect(screen.getByText("Insufficient market data")).toBeTruthy();
    expect(screen.getByText("100% matched")).toBeTruthy();
    expect(screen.getByText("Low confidence")).toBeTruthy();
    expect(screen.queryByText(/\/100/)).toBeNull();
    await userEvent.setup().click(screen.getByText("Why this confidence?"));
    expect(screen.getByText("Only one comparable vehicle is available.")).toBeTruthy();
  });

  it("shows the reference range and keeps unknown preferences explicit", () => {
    const value: DealScore = { ...assessment,
      marketValue: { status: "available", medianPriceCents: 2_200_000,
        askingPriceRange: { lowerCents: 2_100_000, upperCents: 2_300_000 },
        discountPercent: 10, position: "below_range", comparableCount: 6,
        explanation: "Middle 50% of asking prices, not a sale-price prediction." },
      personalFit: { ...assessment.personalFit, status: "partial", unknownCount: 1,
        preferences: [...assessment.personalFit.preferences, { criterion: "transmissions", matched: null, explanation: "Transmission unknown" }] }
    };
    render(<DealAssessment listing={{ scores: [record(value)] }} />);
    expect(screen.getByText("€21,000–€23,000")).toBeTruthy();
    expect(screen.getByText("10% below comparable median")).toBeTruthy();
    expect(screen.getByText("100% of known preferences")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
  });

  it("lets the user compare fit across searches without mixing their preferences", async () => {
    const other: DealScore = { ...assessment,
      personalFit: { ...assessment.personalFit, percent: 0, matchedCount: 0, missedCount: 1,
        preferences: [{ criterion: "sellerPreference", matched: false, explanation: "Private seller preferred" }] }
    };
    render(<DealAssessment listing={{ scores: [record(), record(other, "private", "Private sellers")] }} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Assess for search"), "private");
    expect(screen.getByText("0% matched")).toBeTruthy();
    expect(screen.getByText("Private seller preferred")).toBeTruthy();
    expect(screen.queryByText("Dealer preferred")).toBeNull();
    expect(screen.getByText("Insufficient market data")).toBeTruthy();
  });

  it("keeps all three dimensions pending until required facts are resolved", () => {
    render(<DealAssessment listing={{ scores: [], matchStatus: "needs_information" }} />);
    expect(screen.getAllByText("Not assessed")).toHaveLength(3);
    expect(screen.getByText(/Required vehicle facts are still missing/)).toBeTruthy();
  });
});
