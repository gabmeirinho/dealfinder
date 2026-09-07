// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createVehicleSearchDraft, type ManagedVehicleSearch } from "@dealfinder/domain";
import { ListingDashboard } from "./ListingDashboard.js";
import type { ListingApiClient, ListingDetail } from "../../lib/api/listings.js";

afterEach(cleanup);

const detail: ListingDetail = {
  id: 9,
  title: "<script>alert('x')</script> Volkswagen Golf",
  source: "facebook",
  sourceUrl: "https://www.facebook.com/marketplace/item/9/",
  displayedPrice: "14 950 €",
  currentPriceCents: 1495000,
  availability: "active",
  firstSeenAt: "2026-08-23T10:00:00.000Z",
  lastSeenAt: "2026-08-24T10:00:00.000Z",
  location: "Lisboa",
  review: { state: "shortlisted", archived: false, rejectionReason: null, updatedAt: "2026-08-24T10:00:00.000Z" },
  facts: null,
  risk: { highRiskVerifyPrice: true, reasons: [{ code: "financing_price", label: "HIGH RISK / VERIFY PRICE", explanation: "Listing text mentions financing" }] },
  score: null,
  processing: { state: "completed", lastErrorCode: null },
  original: { title: "<script>alert('x')</script> Volkswagen Golf", description: "<img src=x onerror=alert(1)>", displayedPrice: "14 950 €", cardFacts: ["Diesel"] },
  normalizedFacts: null,
  effectiveFacts: null,
  corrections: [],
  matches: [], scores: [], priceHistory: [], duplicate: null, notes: [],
  sellerMessage: "Hello, is the Volkswagen Golf still available?",
  suggestedQuestions: ["Can I inspect it?"]
};

describe("listing review dashboard", () => {
  it("combines source and budget filters and labels unknown broad-search prices", async () => {
    const client = mockClient();
    const search = { ...createVehicleSearchDraft("Any petrol under 6000"), id: "broad", createdAt: "", updatedAt: "", lastScanAt: null, nextScanAt: null, sourceVerification: { state: "unverified", verifiedAt: null } } as ManagedVehicleSearch;
    search.criteria.searchScope = "broad";
    search.criteria.priceRange = { strength: "hard", value: { minimumEur: null, maximumEur: 6000 } };
    render(<ListingDashboard client={client} initialListings={[{ ...detail, broadSearchNames: [search.name], source: "standvirtual", matchStatus: "needs_information" }]} initialSearches={[search]} />);
    expect(screen.getByText(/Price unknown · Budget not confirmed/)).toBeTruthy();
    expect(screen.getByText(`Broad search · ${search.name}`)).toBeTruthy();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Model / saved search"), search.id);
    await user.selectOptions(screen.getByLabelText("Source"), "standvirtual");
    await user.click(screen.getByLabelText("Under budget · €6,000"));
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(client.list).toHaveBeenCalledWith({ searchId: search.id, source: "standvirtual", underBudget: true, risk: false, archived: false });
    expect(screen.getByText(/Turn off Under budget to review unknown prices/)).toBeTruthy();
  });
  it("filters the shared inbox by the selected saved model target", async () => {
    const client = mockClient();
    const search = { ...createVehicleSearchDraft("SEAT Leon"), id: "leon", createdAt: "", updatedAt: "", lastScanAt: null, nextScanAt: null, sourceVerification: { state: "unverified", verifiedAt: null } } as ManagedVehicleSearch;
    render(<ListingDashboard client={client} initialListings={[detail]} initialSearches={[search]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Model / saved search"), "leon");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(client.list).toHaveBeenCalledWith({ searchId: "leon", risk: false, archived: false });
    await user.selectOptions(screen.getByLabelText("Model / saved search"), "");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(client.list).toHaveBeenLastCalledWith({ risk: false, archived: false });
  });

  it.each(["personal_fit", "best_deal"])("requests the %s dimension when applying filters", async (sort) => {
    const client = mockClient();
    render(<ListingDashboard client={client} initialListings={[detail]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Sort listings"), sort);
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(client.list).toHaveBeenCalledWith({ risk: false, archived: false, sort });
  });

  it("explains missing hard facts without presenting a filter failure", async () => {
    const pending: ListingDetail = {
      ...detail, matchStatus: "needs_information",
      matches: [{ searchId: "golf", searchName: "Diesel Golfs", distance: null,
        evaluation: { eligible: false, status: "needs_information", hardFailures: [],
          missingCriteria: [{ criterion: "fuels", explanation: "fuel is unknown" }] } }]
    };
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValue(pending);
    render(<ListingDashboard client={client} initialListings={[pending]} />);
    expect(screen.getByText(/Needs more information/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: /review .*volkswagen golf/iu }));
    expect(await screen.findByText("fuel is unknown")).toBeTruthy();
    expect(screen.queryByText("Review filter mismatches")).toBeNull();
    expect(screen.queryByText("Hard filters passed")).toBeNull();
  });

  it("renders untrusted copy as text and keeps seller messaging copy-only", async () => {
    const client = mockClient();
    const user = userEvent.setup();
    const { container } = render(<ListingDashboard client={client} initialListings={[detail]} />);
    await user.click(screen.getByRole("button", { name: /review .*volkswagen golf/iu }));

    expect(await screen.findByText("Original listing text")).toBeTruthy();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send/iu })).toBeNull();
  });

  it("moves a listing through the workflow and saves private notes", async () => {
    const client = mockClient();
    const user = userEvent.setup();
    render(<ListingDashboard client={client} initialListings={[detail]} />);
    await user.click(screen.getByRole("button", { name: /review .*volkswagen golf/iu }));
    await user.click(await screen.findByRole("button", { name: "Contacted" }));
    expect(client.setWorkflow).toHaveBeenCalledWith(9, "contacted", null);
    await user.type(screen.getByLabelText("Add a note"), "Check inspection record");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(client.addNote).toHaveBeenCalledWith(9, "Check inspection record");
  });

  it("applies draft filters only when submitted", async () => {
    const client = mockClient();
    const user = userEvent.setup();
    render(<ListingDashboard client={client} initialListings={[detail]} />);

    await user.type(screen.getByLabelText("Find a car"), "Golf");
    await user.click(screen.getByLabelText("High-risk only"));
    expect(client.list).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(client.list).toHaveBeenCalledWith({
      query: "Golf",
      risk: true,
      archived: false
    });
  });

  it("captures Standvirtual details and refreshes persisted failure state", async () => {
    const sv: ListingDetail = { ...detail, source: "standvirtual", title: "Volkswagen Golf", detailFacts: null,
      detailCapture: { state: "not_captured", stale: true, canCapture: true, nextAttemptAt: null, lastErrorCode: null } };
    const client = mockClient();
    vi.mocked(client.get).mockResolvedValueOnce(sv).mockResolvedValue({ ...sv, detailCapture: { state: "failed", stale: true,
      canCapture: false, nextAttemptAt: "2026-09-09T12:00:00Z", lastErrorCode: "STANDVIRTUAL_DETAIL_BLOCKED" } });
    vi.mocked(client.captureDescription).mockRejectedValue(new Error("Standvirtual requires verification"));
    render(<ListingDashboard client={client} initialListings={[sv]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review Volkswagen Golf" }));
    await user.click(await screen.findByRole("button", { name: "Capture Standvirtual details" }));
    expect(client.captureDescription).toHaveBeenCalledWith(sv.id);
    expect(await screen.findByText(/Last capture failed: STANDVIRTUAL_DETAIL_BLOCKED/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Capture Standvirtual details" }).disabled).toBe(true);
    expect(screen.getByText("Result card evidence")).toBeTruthy();
  });

  it("clears unsaved inspector drafts when another listing opens", async () => {
    const other = { ...detail, id: 10, title: "2012 Volkswagen Golf Variant" };
    const client = mockClient();
    vi.mocked(client.get).mockImplementation(async (id) => id === detail.id ? detail : other);
    const user = userEvent.setup();
    render(<ListingDashboard client={client} initialListings={[detail, other]} />);

    await user.click(screen.getByRole("button", { name: /review .*script.*volkswagen golf/iu }));
    await user.type(await screen.findByLabelText("Rejection reason"), "Wrong car");
    await user.type(screen.getByLabelText("Add a note"), "Unsaved note");

    await user.click(screen.getByRole("button", { name: "Review 2012 Volkswagen Golf Variant" }));
    expect(await screen.findByRole("heading", { name: "2012 Volkswagen Golf Variant" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Rejection reason").value).toBe("");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Add a note").value).toBe("");
  });
});

function mockClient(): ListingApiClient {
  return {
    list: vi.fn(async () => [detail]),
    get: vi.fn(async () => detail),
    setWorkflow: vi.fn(async (_id, state) => ({ ...detail, review: { ...detail.review, state } })),
    archive: vi.fn(async () => detail),
    addNote: vi.fn(async () => detail),
    captureDescription: vi.fn(async () => detail),
    markSold: vi.fn(async () => detail),
    correct: vi.fn(async () => detail),
    decideRule: vi.fn(async () => undefined)
  };
}
