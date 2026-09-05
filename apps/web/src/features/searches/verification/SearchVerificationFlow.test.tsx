// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManagedVehicleSearch } from "@dealfinder/domain";

import type { SearchApiClient } from "../../../lib/api/searches.js";
import type { SearchVerificationApiClient } from "../../../lib/api/search-verification.js";
import { SearchDashboard } from "../SearchDashboard.js";

afterEach(cleanup);

describe("assisted Facebook verification flow", () => {
  it("opens generated results, confirms, and refreshes the verified state", async () => {
    const user = userEvent.setup();
    const original = search("unverified");
    const verified = search("verified");
    const openFacebook = vi.fn(async () => ({
      searchId: original.id,
      source: "facebook" as const,
      state: "pending" as const,
      generatedUrl: "https://www.facebook.com/marketplace/category/vehicles/?query=Golf",
      supportedFilters: ["criteria.makeKeywords"],
      postFilters: [{
        field: "location" as const,
        label: "Location: Lisbon, Portugal within 150 km",
        reason: "Confirm location in Facebook."
      }]
    }));
    const confirmFacebook = vi.fn(async () => ({
      searchId: original.id,
      source: "facebook" as const,
      state: "verified" as const,
      verifiedAt: "2026-08-20T12:00:00.000Z"
    }));
    const verificationClient: SearchVerificationApiClient = {
      openFacebook,
      confirmFacebook,
      rejectFacebook: async () => ({
        searchId: original.id,
        source: "facebook",
        state: "rejected"
      })
    };
    const client = searchClient(verified);
    render(
      <SearchDashboard
        client={client}
        verificationClient={verificationClient}
        initialSearches={[original]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Verify Facebook" }));
    expect(openFacebook).toHaveBeenCalledWith(original.id);
    await screen.findByRole("dialog", { name: "Check Golf on Facebook" });

    await user.click(screen.getByRole("button", { name: "Confirm results" }));

    expect(confirmFacebook).toHaveBeenCalledWith(original.id);
    expect(await screen.findByText("Golf verified for Facebook Marketplace.")).toBeTruthy();
    expect(screen.getByText(/Verified/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify again" })).toBeTruthy();
  });
});

function search(state: "unverified" | "verified"): ManagedVehicleSearch {
  return {
    id: "search-1",
    name: "Golf",
    priority: 1,
    active: true,
    criteria: {
      makeKeywords: { value: ["Volkswagen"], strength: "hard" },
      modelKeywords: { value: ["Golf"], strength: "hard" },
      variantKeywords: null,
      priceRange: null,
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
    sourceVerification: {
      state,
      verifiedAt: state === "verified" ? "2026-08-20T12:00:00.000Z" : null
    }
  };
}

function searchClient(listed: ManagedVehicleSearch): SearchApiClient {
  return {
    list: async () => [listed],
    createModels: async () => [],
    create: async () => listed,
    update: async () => listed,
    duplicate: async () => listed,
    activate: async () => listed,
    pause: async () => listed,
    delete: async () => undefined,
    reprioritize: async () => [listed],
    requestScan: async () => ({
      runId: "run-1",
      searchId: listed.id,
      status: "pending",
      requestedAt: "2026-08-20T12:00:00.000Z"
    })
  };
}
