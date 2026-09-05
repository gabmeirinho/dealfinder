import { afterEach, describe, expect, it } from "vitest";

import {
  SearchValidationError,
  createVehicleSearchDraft,
  type VehicleSearchDraft
} from "@dealfinder/domain";

import { openDatabase, type DatabaseConnection } from "../connection.js";
import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

describe("searches repository", () => {
  let testDatabase: TestDatabase | undefined;
  let reopenedConnection: DatabaseConnection | undefined;

  afterEach(() => {
    reopenedConnection?.close();
    testDatabase?.cleanup();
    reopenedConnection = undefined;
    testDatabase = undefined;
  });

  it("persists scan limits across reopening the database", () => {
    testDatabase = createTestDatabase();
    const draft = completeSearch();
    draft.scanLimits = { initialCardLimit: 500, knownListingStopCount: 100, maxCards: 1500, maxDurationSeconds: 180 };
    const saved = testDatabase.connection.searches.create(draft);
    reopenedConnection = openDatabase({ filename: testDatabase.filename });
    expect(reopenedConnection.searches.get(saved.id)?.scanLimits).toEqual(draft.scanLimits);
  });

  it("round-trips every criterion without losing hard and soft semantics", () => {
    const now = new Date("2026-08-19T10:30:00.000Z");
    testDatabase = createTestDatabase();
    testDatabase.connection.close();
    reopenedConnection = openDatabase({
      filename: testDatabase.filename,
      now: () => now
    });

    const draft = completeSearch();
    const created = reopenedConnection.searches.create(draft);

    expect(created).toMatchObject({
      name: "Golf GTE",
      active: true,
      priority: 2,
      criteria: draft.criteria,
      location: draft.location,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    expect(reopenedConnection.searches.get(created.id)).toEqual(created);

    reopenedConnection.close();
    reopenedConnection = openDatabase({ filename: testDatabase.filename });
    expect(reopenedConnection.searches.get(created.id)).toEqual(created);
  });

  it("stores radius and nationwide locations without mixing their fields", () => {
    testDatabase = createTestDatabase();
    const local = createVehicleSearchDraft("Local Volvo");
    local.criteria.makeKeywords = { value: ["Volvo"], strength: "hard" };
    const nationwide = createVehicleSearchDraft("Nationwide Toyota");
    nationwide.priority = 2;
    nationwide.criteria.makeKeywords = { value: ["Toyota"], strength: "soft" };
    nationwide.location = { mode: "nationwide", origin: null, radiusKm: null };

    const localSearch = testDatabase.connection.searches.create(local);
    const nationwideSearch = testDatabase.connection.searches.create(nationwide);

    expect(localSearch.location).toEqual({
      mode: "radius",
      origin: "Lisbon, Portugal",
      radiusKm: 150
    });
    expect(nationwideSearch.location).toEqual({
      mode: "nationwide",
      origin: null,
      radiusKm: null
    });
  });

  it("validates before insert and leaves the database unchanged", () => {
    testDatabase = createTestDatabase();
    const invalid = createVehicleSearchDraft("Invalid");
    invalid.criteria.makeKeywords = { value: ["BMW"], strength: "hard" };
    invalid.criteria.priceRange = {
      value: { minimumEur: 30_000, maximumEur: 20_000 },
      strength: "hard"
    };

    expect(() => testDatabase?.connection.searches.create(invalid)).toThrow(
      SearchValidationError
    );
    expect(testDatabase.connection.searches.list()).toEqual([]);
  });

  it("updates, orders, and deletes saved searches", () => {
    let now = new Date("2026-08-19T10:30:00.000Z");
    testDatabase = createTestDatabase();
    testDatabase.connection.close();
    reopenedConnection = openDatabase({ filename: testDatabase.filename, now: () => now });
    const lowerPriority = completeSearch();
    lowerPriority.priority = 10;
    const first = reopenedConnection.searches.create(lowerPriority);
    const higherPriority = completeSearch();
    higherPriority.name = "Higher priority";
    higherPriority.priority = 1;
    const second = reopenedConnection.searches.create(higherPriority);

    expect(reopenedConnection.searches.list().map(({ id }) => id)).toEqual([
      second.id,
      first.id
    ]);

    now = new Date("2026-08-20T11:00:00.000Z");
    higherPriority.active = false;
    const updated = reopenedConnection.searches.update(second.id, higherPriority);
    expect(updated).toMatchObject({
      active: false,
      createdAt: "2026-08-19T10:30:00.000Z",
      updatedAt: "2026-08-20T11:00:00.000Z"
    });
    expect(reopenedConnection.searches.delete(first.id)).toBe(true);
    expect(reopenedConnection.searches.delete(first.id)).toBe(false);
  });
});

function completeSearch(): VehicleSearchDraft {
  const draft = createVehicleSearchDraft("Golf GTE");
  draft.priority = 2;
  draft.criteria = {
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
    requiredKeywords: { value: ["service history"], strength: "hard" },
    excludedKeywords: { value: ["damaged"], strength: "hard" }
  };
  return draft;
}
