import { afterEach, describe, expect, it } from "vitest";

import { createVehicleSearchDraft } from "@dealfinder/domain";

import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

describe("search source verification repository", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(() => testDatabase?.cleanup());

  it("persists and replaces an explicitly confirmed source URL", () => {
    testDatabase = createTestDatabase();
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = testDatabase.connection.searches.create(draft);

    const first = testDatabase.connection.searchSources.saveVerification({
      searchId: search.id,
      source: "facebook",
      sourceUrl: "https://www.facebook.com/marketplace/category/vehicles/?query=Golf",
      criteriaFingerprint: "a".repeat(64),
      verifiedAt: "2026-08-20T10:00:00.000Z"
    });
    const replacement = testDatabase.connection.searchSources.saveVerification({
      searchId: search.id,
      source: "facebook",
      sourceUrl: "https://www.facebook.com/marketplace/lisbon/vehicles/?query=Golf",
      criteriaFingerprint: "b".repeat(64),
      verifiedAt: "2026-08-20T11:00:00.000Z"
    });

    expect(first.sourceUrl).toContain("category/vehicles");
    expect(replacement).toMatchObject({
      sourceUrl: "https://www.facebook.com/marketplace/lisbon/vehicles/?query=Golf",
      criteriaFingerprint: "b".repeat(64),
      verifiedAt: "2026-08-20T11:00:00.000Z"
    });
    expect(testDatabase.connection.searchSources.get(search.id, "facebook")).toEqual(replacement);
  });

  it("removes source verification when its search is deleted", () => {
    testDatabase = createTestDatabase();
    const draft = createVehicleSearchDraft("Volvo");
    draft.criteria.makeKeywords = { value: ["Volvo"], strength: "hard" };
    const search = testDatabase.connection.searches.create(draft);
    testDatabase.connection.searchSources.saveVerification({
      searchId: search.id,
      source: "facebook",
      sourceUrl: "https://www.facebook.com/marketplace/category/vehicles/?query=Volvo",
      criteriaFingerprint: "c".repeat(64),
      verifiedAt: "2026-08-20T10:00:00.000Z"
    });

    testDatabase.connection.searches.delete(search.id);

    expect(testDatabase.connection.searchSources.get(search.id, "facebook")).toBeUndefined();
  });

  it("never creates a row before explicit save", () => {
    testDatabase = createTestDatabase();
    const draft = createVehicleSearchDraft("Toyota");
    draft.criteria.makeKeywords = { value: ["Toyota"], strength: "hard" };
    const search = testDatabase.connection.searches.create(draft);

    expect(testDatabase.connection.searchSources.get(search.id, "facebook")).toBeUndefined();
  });
});
