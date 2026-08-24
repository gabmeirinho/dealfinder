// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManagedVehicleSearch, VehicleSearchDraft } from "@dealfinder/domain";

import {
  SearchApiError,
  type SearchApiClient
} from "../../lib/api/searches.js";
import { SearchDashboard } from "./SearchDashboard.js";

afterEach(cleanup);

describe("saved-search dashboard interactions", () => {
  it("contains keyboard focus and confirms the active-search override", async () => {
    const user = userEvent.setup();
    const create = vi.fn(async (draft: VehicleSearchDraft, override = false) => {
      if (!override) {
        throw new SearchApiError(
          409,
          "ACTIVE_SEARCH_LIMIT_CONFIRMATION_REQUIRED",
          "Activating more than 10 searches requires confirmation"
        );
      }
      return fromDraft("created", draft);
    });
    const client = createClient({ create });

    render(<SearchDashboard client={client} initialSearches={[]} />);
    await user.click(screen.getByRole("button", { name: "New search" }));

    const editor = screen.getByRole("dialog", { name: "Create saved search" });
    const name = within(editor).getByLabelText("Search name");
    expect(document.activeElement).toBe(name);

    const close = within(editor).getByRole("button", { name: "Close search editor" });
    const save = within(editor).getByRole("button", { name: "Create search" });
    close.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);

    await user.type(name, "Lisbon Golf");
    await user.type(within(editor).getByLabelText("Make keywords"), "Volkswagen");
    await user.click(save);

    const confirmation = await screen.findByRole("alertdialog", {
      name: "Run more than ten active searches?"
    });
    expect(document.activeElement).toBe(
      within(confirmation).getByRole("button", { name: "Cancel" })
    );
    await user.click(within(confirmation).getByRole("button", { name: "Activate anyway" }));

    await screen.findByRole("heading", { name: "Lisbon Golf" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map((call) => call[1])).toEqual([false, true]);
  });

  it("edits, duplicates, pauses, reprioritizes, and deletes resolved searches", async () => {
    const user = userEvent.setup();
    const first = managedSearch("first", "Golf GTE", 1);
    const second = managedSearch("second", "Volvo V60", 2);
    const duplicate = { ...first, id: "duplicate", name: "Updated Golf copy", priority: 3, active: false };
    const update = vi.fn(async (id: string, draft: VehicleSearchDraft) => fromDraft(id, draft));
    const duplicateRequest = vi.fn(async () => duplicate);
    const pause = vi.fn(async () => ({ ...first, name: "Updated Golf", active: false }));
    const reprioritize = vi.fn(async (ids: readonly string[]) => ids.map((id, index) => ({
      ...(id === second.id ? second : id === duplicate.id ? duplicate : { ...first, name: "Updated Golf" }),
      priority: index + 1
    })));
    const remove = vi.fn(async () => undefined);
    const client = createClient({
      update,
      duplicate: duplicateRequest,
      pause,
      reprioritize,
      delete: remove
    });

    render(<SearchDashboard client={client} initialSearches={[first, second]} />);

    await user.click(within(rowFor("Golf GTE")).getByRole("button", { name: "Edit" }));
    const name = screen.getByLabelText("Search name");
    await user.clear(name);
    await user.type(name, "Updated Golf");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { name: "Updated Golf" });
    expect(update).toHaveBeenCalledOnce();

    await user.click(within(rowFor("Updated Golf")).getByRole("button", { name: "Duplicate" }));
    await screen.findByRole("heading", { name: "Updated Golf copy" });
    expect(duplicateRequest).toHaveBeenCalledWith(first.id);

    await user.click(within(rowFor("Updated Golf")).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(within(rowFor("Updated Golf")).getByText("Paused")).toBeTruthy());
    expect(pause).toHaveBeenCalledWith(first.id);

    await user.click(within(rowFor("Volvo V60")).getByRole("button", { name: "Move Volvo V60 up" }));
    await waitFor(() => expect(reprioritize).toHaveBeenCalledWith([
      second.id,
      first.id,
      duplicate.id
    ]));

    await user.click(within(rowFor("Updated Golf copy")).getByRole("button", { name: "Delete" }));
    const confirmation = await screen.findByRole("alertdialog", {
      name: "Delete “Updated Golf copy”?"
    });
    await user.click(within(confirmation).getByRole("button", { name: "Delete search" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Updated Golf copy" })).toBeNull());
    expect(remove).toHaveBeenCalledWith(duplicate.id);
  });
});

function rowFor(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const row = heading.closest("li");
  if (row === null) throw new Error(`Search row not found: ${name}`);
  return row;
}

function createClient(overrides: Partial<SearchApiClient>): SearchApiClient {
  return {
    list: async () => [],
    create: async (draft) => fromDraft("created", draft),
    update: async (id, draft) => fromDraft(id, draft),
    duplicate: async () => managedSearch("duplicate", "Duplicate", 2),
    activate: async () => managedSearch("active", "Active", 1),
    pause: async () => managedSearch("paused", "Paused", 1, false),
    delete: async () => undefined,
    reprioritize: async () => [],
    requestScan: async (id) => ({
      runId: "run-1",
      searchId: id,
      status: "pending",
      requestedAt: "2026-08-19T12:30:00.000Z"
    }),
    ...overrides
  };
}

function fromDraft(id: string, draft: VehicleSearchDraft): ManagedVehicleSearch {
  return {
    id,
    ...draft,
    location: draft.location.mode === "nationwide"
      ? { mode: "nationwide", origin: null, radiusKm: null }
      : { mode: "radius", origin: draft.location.origin ?? "Lisbon, Portugal", radiusKm: 150 },
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    lastScanAt: null,
    nextScanAt: null,
    sourceVerification: { state: "unverified", verifiedAt: null }
  };
}

function managedSearch(
  id: string,
  name: string,
  priority: number,
  active = true
): ManagedVehicleSearch {
  return {
    id,
    name,
    priority,
    active,
    criteria: {
      makeKeywords: { value: [name.split(" ")[0] ?? name], strength: "hard" },
      modelKeywords: null,
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
    createdAt: `2026-08-19T12:0${priority}:00.000Z`,
    updatedAt: `2026-08-19T12:0${priority}:00.000Z`,
    lastScanAt: null,
    nextScanAt: null,
    sourceVerification: { state: "unverified", verifiedAt: null }
  };
}
