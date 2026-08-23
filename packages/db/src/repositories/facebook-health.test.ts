import { afterEach, describe, expect, it } from "vitest";

import { createVehicleSearchDraft } from "@dealfinder/domain";

import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

describe("Facebook health repository", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(() => testDatabase?.cleanup());

  it.each([
    ["browser", "facebook-browser"],
    ["source", "facebook"],
    ["search", "search-id"]
  ] as const)("blocks the applicable search for a %s pause", (scope, scopeKey) => {
    testDatabase = createTestDatabase();
    const search = createSearch(testDatabase);
    const effectiveKey = scope === "search" ? search.id : scopeKey;
    const pause = testDatabase.connection.facebookHealth.pause({
      scope,
      scopeKey: effectiveKey,
      searchId: scope === "search" ? search.id : null,
      failureKind: scope === "search" ? "empty_results" : "selector_contract",
      detail: "Manual review required",
      diagnosticId: null,
      pausedAt: "2026-08-23T09:00:00.000Z"
    });

    expect(testDatabase.connection.facebookHealth.isBlocked(search.id)).toBe(true);
    expect(testDatabase.connection.facebookHealth.listActivePauses()).toEqual([pause]);
    expect(testDatabase.connection.facebookHealth.resolve(
      pause.id,
      "2026-08-23T10:00:00.000Z"
    )).toMatchObject({ resolvedAt: "2026-08-23T10:00:00.000Z" });
    expect(testDatabase.connection.facebookHealth.isBlocked(search.id)).toBe(false);
  });

  it("updates one active pause instead of creating retry noise", () => {
    testDatabase = createTestDatabase();
    const search = createSearch(testDatabase);
    const repository = testDatabase.connection.facebookHealth;
    const first = repository.pause({
      scope: "search",
      scopeKey: search.id,
      searchId: search.id,
      failureKind: "partial_load",
      detail: "First failure",
      diagnosticId: null,
      pausedAt: "2026-08-23T09:00:00.000Z"
    });
    const repeated = repository.pause({
      scope: "search",
      scopeKey: search.id,
      searchId: search.id,
      failureKind: "empty_results",
      detail: "Latest evidence",
      diagnosticId: null,
      pausedAt: "2026-08-23T09:05:00.000Z"
    });

    expect(repeated.id).toBe(first.id);
    expect(repository.listActivePauses()).toHaveLength(1);
    expect(repeated).toMatchObject({
      failureKind: "empty_results",
      detail: "Latest evidence"
    });
  });
});

function createSearch(testDatabase: TestDatabase) {
  const draft = createVehicleSearchDraft("Golf");
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  return testDatabase.connection.searches.create(draft);
}
