// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StandvirtualDetails } from "./StandvirtualDetails.js";
import type { ListingDetail } from "../../lib/api/listings.js";
afterEach(cleanup);
it("shows captured evidence, conflicts and the separate card provenance", () => {
  const listing = { original: { cardFacts: ["100 000 km"] }, detailFacts: {
    capturedAt: "2026-09-08T12:00:00Z", conflicts: ["mileageKm"],
    evidence: { warranty: "18 Meses", inspection: "2027-06", equipment: ["Bluetooth"], importStatus: "national", sellerType: "dealer", postedDate: null }
  }, cardEvidence: { observedAt: "2026-09-07T12:00:00Z", description: null, cardFacts: ["100 000 km"] },
  detailCapture: { state: "succeeded", stale: false, canCapture: false, nextAttemptAt: "2026-09-15T12:00:00Z", lastErrorCode: null } } as ListingDetail;
  render(<StandvirtualDetails listing={listing} busy={false} onCapture={vi.fn()} />);
  for (const text of ["18 Meses", "2027-06", "Bluetooth", "National", "Dealer", "Facts to verify", "100 000 km"]) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Capture Standvirtual details" })).toBeNull();
});
it("offers recapture for stale details and labels missing evidence", () => {
  const listing = { original: { cardFacts: [] }, detailFacts: { capturedAt: "2026-08-01", conflicts: [], evidence: null },
    detailCapture: { state: "succeeded", stale: true, canCapture: true, nextAttemptAt: null, lastErrorCode: null } } as unknown as ListingDetail;
  render(<StandvirtualDetails listing={listing} busy={false} onCapture={vi.fn()} />);
  expect(screen.getByText(/Stale evidence/)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Capture Standvirtual details" }).disabled).toBe(false);
  expect(screen.getByText("No equipment evidence captured.")).toBeTruthy();
});
