import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./testing/create-test-database.js";

describe("database transactions", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(() => {
    testDatabase?.cleanup();
    testDatabase = undefined;
  });

  it("rolls back all writes when an operation fails", () => {
    testDatabase = createTestDatabase();

    expect(() =>
      testDatabase?.connection.transaction(() => {
        testDatabase?.connection.settings.set("dashboard.locale", "en-GB");
        testDatabase?.connection.settings.set("dashboard.theme", "dark");
        throw new Error("stop");
      })
    ).toThrow("stop");

    expect(testDatabase.connection.settings.list()).toEqual([]);
  });

  it("supports nested atomic operations", () => {
    testDatabase = createTestDatabase();

    testDatabase.connection.transaction(() => {
      testDatabase?.connection.settings.set("dashboard.locale", "en-GB");

      expect(() =>
        testDatabase?.connection.transaction(() => {
          testDatabase?.connection.settings.set("dashboard.theme", "dark");
          throw new Error("inner failure");
        })
      ).toThrow("inner failure");
    });

    expect(testDatabase.connection.settings.list().map((setting) => setting.key)).toEqual([
      "dashboard.locale"
    ]);
  });
});
