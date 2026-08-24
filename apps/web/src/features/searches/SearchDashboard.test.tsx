import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ManagedVehicleSearch } from "@dealfinder/domain";

import { createSearchApiClient } from "../../lib/api/searches.js";
import {
  SearchDashboard,
  SearchEditor,
  type EditorState
} from "./SearchDashboard.js";
import {
  createSearchForm,
  draftToSearchForm,
  searchFormToDraft
} from "./form-model.js";

describe("saved-search dashboard", () => {
  it("renders a directional empty state and capacity context", () => {
    const markup = renderToStaticMarkup(<SearchDashboard initialSearches={[]} />);

    expect(markup).toContain("Saved searches");
    expect(markup).toContain("<strong>0</strong> active");
    expect(markup).toContain("/ 10 recommended");
    expect(markup).toContain("Set your first search");
    expect(markup).toContain("Create a saved search");
  });

  it("shows management, scan, verification, status, and priority controls", () => {
    const search = managedSearch();
    const markup = renderToStaticMarkup(
      <SearchDashboard initialSearches={[search]} />
    );

    expect(markup).toContain("Golf GTE");
    expect(markup).toContain("Volkswagen · Golf · GTE");
    expect(markup).toContain("Not verified");
    expect(markup).toContain("Never scanned");
    expect(markup).toContain("Not scheduled");
    expect(markup).toContain("Edit");
    expect(markup).toContain("Scan");
    expect(markup).toContain("Pause");
    expect(markup).toContain("Duplicate");
    expect(markup).toContain("Delete");
    expect(markup).toContain('aria-label="Move Golf GTE up"');
    expect(markup).toContain('aria-label="Move Golf GTE down"');
  });

  it("formats verified and scan timestamps in Lisbon time", () => {
    const search = managedSearch();
    search.sourceVerification = {
      state: "verified",
      verifiedAt: "2026-08-19T12:00:00.000Z"
    };
    search.lastScanAt = "2026-08-19T12:15:00.000Z";
    search.nextScanAt = "2026-08-19T13:30:00.000Z";

    const markup = renderToStaticMarkup(
      <SearchDashboard initialSearches={[search]} />
    );

    expect(markup).toContain("Verified · 19 Aug, 13:00");
    expect(markup).toContain("19 Aug, 13:15");
    expect(markup).toContain("19 Aug, 14:30");
    expect(markup).not.toContain("2026-08-19T12:15:00.000Z");
  });

  it("renders every confirmed filter with native keyboard controls and field errors", () => {
    const editor: EditorState = {
      mode: "create",
      searchId: null,
      form: createSearchForm(),
      fieldErrors: {
        name: ["must contain 1-100 characters"],
        "location.radiusKm": ["must be a selectable radius"]
      }
    };
    const markup = renderToStaticMarkup(
      <SearchEditor
        editor={editor}
        pending={false}
        active
        onChange={() => undefined}
        onClose={() => undefined}
        onSave={() => undefined}
      />
    );

    for (const label of [
      "Search name",
      "Priority",
      "Make keywords",
      "Model keywords",
      "Variant keywords",
      "Minimum EUR",
      "Maximum EUR",
      "Minimum year",
      "Maximum mileage (km)",
      "Minimum power (hp)",
      "Seller preference",
      "Fuel",
      "Transmission",
      "Required keywords",
      "Excluded keywords",
      "Location mode",
      "Origin",
      "Radius"
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("Create saved search");
    expect(markup).toContain("must contain 1-100 characters");
    expect(markup).not.toContain('tabindex="-1"');
  });

  it("converts all form fields without losing hard, soft, or nationwide semantics", () => {
    const form = draftToSearchForm(managedSearch());
    form.locationMode = "nationwide";
    form.requiredKeywords = "service history, one owner";
    form.requiredStrength = "hard";
    form.excludedKeywords = "damaged";
    form.excludedStrength = "soft";
    form.fuels = ["petrol", "hybrid"];
    form.fuelStrength = "soft";

    const draft = searchFormToDraft(form);

    expect(draft.location).toEqual({
      mode: "nationwide",
      origin: null,
      radiusKm: null
    });
    expect(draft.criteria.requiredKeywords).toEqual({
      value: ["service history", "one owner"],
      strength: "hard"
    });
    expect(draft.criteria.excludedKeywords?.strength).toBe("soft");
    expect(draft.criteria.fuels).toEqual({
      value: ["petrol", "hybrid"],
      strength: "soft"
    });
  });

  it("maps every management operation to the P2C2 API contract", async () => {
    const calls: Array<{ path: string; method: string; body: string }> = [];
    const search = managedSearch();
    const request = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = String(input);
      const method = init?.method ?? "GET";
      calls.push({ path, method, body: String(init?.body ?? "") });
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (path.endsWith("/scan")) {
        return Response.json({
          searchId: search.id,
          status: "pending",
          requestedAt: "2026-08-19T12:30:00.000Z"
        });
      }
      if (path.endsWith("/priorities") || (path === "/api/searches" && method === "GET")) {
        return Response.json({ searches: [search] });
      }
      return Response.json({ search });
    };
    const client = createSearchApiClient(request as typeof fetch);
    const draft = searchFormToDraft(draftToSearchForm(search));

    await client.list();
    await client.create(draft, true);
    await client.update(search.id, draft);
    await client.duplicate(search.id);
    await client.activate(search.id, true);
    await client.pause(search.id);
    await client.requestScan(search.id);
    await client.reprioritize([search.id]);
    await client.delete(search.id);

    expect(calls.map(({ path, method }) => `${method} ${path}`)).toEqual([
      "GET /api/searches",
      "POST /api/searches",
      `PUT /api/searches/${search.id}`,
      `POST /api/searches/${search.id}/duplicate`,
      `POST /api/searches/${search.id}/activate`,
      `POST /api/searches/${search.id}/pause`,
      `POST /api/searches/${search.id}/scan`,
      "PUT /api/searches/priorities",
      `DELETE /api/searches/${search.id}`
    ]);
    expect(calls[1]?.body).toContain('"overrideActiveLimit":true');
    expect(calls[4]?.body).toContain('"overrideActiveLimit":true');
  });
});

function managedSearch(): ManagedVehicleSearch {
  return {
    id: "search-1",
    name: "Golf GTE",
    priority: 1,
    active: true,
    criteria: {
      makeKeywords: { value: ["Volkswagen"], strength: "hard" },
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
      requiredKeywords: null,
      excludedKeywords: { value: ["damaged"], strength: "hard" }
    },
    location: { mode: "radius", origin: "Lisbon, Portugal", radiusKm: 150 },
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    lastScanAt: null,
    nextScanAt: null,
    sourceVerification: { state: "unverified", verifiedAt: null }
  };
}
