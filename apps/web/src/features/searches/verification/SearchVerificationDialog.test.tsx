// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ManagedVehicleSearch,
  SearchVerificationPreview
} from "@dealfinder/domain";

import { SearchVerificationDialog } from "./SearchVerificationDialog.js";

afterEach(cleanup);

describe("Facebook verification dialog", () => {
  it("separates generated Facebook filters from local post-filters", () => {
    render(
      <SearchVerificationDialog
        search={search()}
        preview={preview()}
        pending={false}
        error={null}
        onConfirm={() => undefined}
        onReject={() => undefined}
      />
    );

    expect(screen.getByRole("dialog", { name: "Check Golf on Facebook" })).toBeTruthy();
    expect(screen.getByText("Price range")).toBeTruthy();
    expect(screen.getByText("Volkswagen")).toBeTruthy();
    expect(screen.getByText("€15,000–€25,000")).toBeTruthy();
    expect(screen.getByText("Location: Lisbon, Portugal within 150 km")).toBeTruthy();
    expect(screen.getByText("Captured automatically")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers explicit confirm and reject actions", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    render(
      <SearchVerificationDialog
        search={search()}
        preview={preview()}
        pending={false}
        error={null}
        onConfirm={onConfirm}
        onReject={onReject}
      />
    );

    await user.click(screen.getByRole("button", { name: "Confirm results" }));
    await user.click(screen.getByRole("button", { name: "Reject results" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("keeps forward and reverse tab focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <SearchVerificationDialog
        search={search()}
        preview={preview()}
        pending={false}
        error={null}
        onConfirm={() => undefined}
        onReject={() => undefined}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Check Golf on Facebook" });
    const reject = screen.getByRole("button", { name: "Reject results" });
    const confirm = screen.getByRole("button", { name: "Confirm results" });
    expect(document.activeElement).toBe(dialog);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(reject);
  });
});

function preview(): SearchVerificationPreview {
  return {
    searchId: "search-1",
    source: "facebook",
    state: "pending",
    generatedUrl: "https://www.facebook.com/marketplace/category/vehicles/?query=Golf",
    supportedFilters: ["criteria.makeKeywords", "criteria.priceRange"],
    postFilters: [{
      field: "location",
      label: "Location: Lisbon, Portugal within 150 km",
      reason: "Confirm Facebook's location and distance controls in the visible browser."
    }]
  };
}

function search(): ManagedVehicleSearch {
  return {
    id: "search-1",
    name: "Golf",
    priority: 1,
    active: true,
    criteria: {
      makeKeywords: { value: ["Volkswagen"], strength: "hard" },
      modelKeywords: { value: ["Golf"], strength: "hard" },
      variantKeywords: null,
      priceRange: {
        value: { minimumEur: 15_000, maximumEur: 25_000 },
        strength: "hard"
      },
      minimumYear: null,
      maximumMileageKm: null,
      fuels: null,
      transmissions: null,
      minimumPowerHp: null,
      sellerPreference: null,
      requiredKeywords: null,
      excludedKeywords: null
    },
    location: { mode: "radius", origin: "Lisbon, Portugal", radiusKm: 150 },
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    lastScanAt: null,
    nextScanAt: null,
    sourceVerification: { state: "unverified", verifiedAt: null }
  };
}
