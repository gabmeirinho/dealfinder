import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "../connection.js";
import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

describe("settings repository", () => {
  let testDatabase: TestDatabase | undefined;
  let reopenedConnection: DatabaseConnection | undefined;

  afterEach(() => {
    reopenedConnection?.close();
    testDatabase?.cleanup();
    reopenedConnection = undefined;
    testDatabase = undefined;
  });

  it("inserts and updates non-secret settings", () => {
    let currentTime = new Date("2026-01-01T10:00:00.000Z");
    testDatabase = createTestDatabase();
    testDatabase.connection.close();
    reopenedConnection = openDatabase({
      filename: testDatabase.filename,
      now: () => currentTime
    });

    expect(reopenedConnection.settings.set("dashboard.locale", "en-GB")).toEqual({
      key: "dashboard.locale",
      value: "en-GB",
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z"
    });

    currentTime = new Date("2026-01-02T11:00:00.000Z");
    expect(reopenedConnection.settings.set("dashboard.locale", "en-US")).toEqual({
      key: "dashboard.locale",
      value: "en-US",
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-02T11:00:00.000Z"
    });
    expect(reopenedConnection.settings.list()).toHaveLength(1);
  });

  it("persists settings across connection restarts", () => {
    testDatabase = createTestDatabase();
    testDatabase.connection.settings.set("dashboard.locale", "en-GB");
    testDatabase.connection.close();

    reopenedConnection = openDatabase({ filename: testDatabase.filename });

    expect(reopenedConnection.settings.get("dashboard.locale")?.value).toBe("en-GB");
  });

  it("rejects keys intended for secrets or session data", () => {
    testDatabase = createTestDatabase();

    expect(() =>
      testDatabase?.connection.settings.set("deepseek.api-key", "must-not-persist")
    ).toThrow(/Sensitive setting keys/u);
    expect(() =>
      testDatabase?.connection.settings.set("facebook.session", "must-not-persist")
    ).toThrow(/Sensitive setting keys/u);
    expect(testDatabase.connection.settings.list()).toEqual([]);
  });
});
