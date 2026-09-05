// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListingDashboard } from "./ListingDashboard.js";
import type { ListingApiClient, ListingDetail } from "../../lib/api/listings.js";

afterEach(cleanup);

const detail: ListingDetail = {
  id: 9,
  title: "<script>alert('x')</script> Volkswagen Golf",
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
  it("requests the selected assessment dimension when applying filters", async () => {
    const client = mockClient();
    render(<ListingDashboard client={client} initialListings={[detail]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Sort listings"), "personal_fit");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(client.list).toHaveBeenCalledWith({ risk: false, archived: false, sort: "personal_fit" });
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
