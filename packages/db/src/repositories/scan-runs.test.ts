import { afterEach, describe, expect, it } from "vitest";

import { createVehicleSearchDraft } from "@dealfinder/domain";
import { openDatabase } from "../connection.js";

import { createTestDatabase, type TestDatabase } from "../testing/create-test-database.js";

describe("scan runs repository", () => {
  let testDatabase: TestDatabase | undefined;

  afterEach(() => testDatabase?.cleanup());

  it("persists an idempotent queued run and its state transitions", () => {
    testDatabase = createTestDatabase();
    const search = createSearch(testDatabase);
    const repository = testDatabase.connection.scanRuns;

    const queued = repository.enqueue(search.id, "manual", "2026-08-23T09:00:00.000Z");
    const duplicate = repository.enqueue(search.id, "scheduled", "2026-08-23T09:01:00.000Z");
    expect(duplicate).toEqual(queued);

    repository.markRunning(queued.id, "2026-08-23T09:02:00.000Z");
    const next = repository.enqueue(search.id, "manual", "2026-08-23T09:03:00.000Z");
    const completed = repository.complete({
      runId: queued.id,
      completedAt: "2026-08-23T09:04:00.000Z",
      cardsSeen: 42,
      newCandidates: 7
    });

    expect(completed).toMatchObject({ state: "succeeded", cardsSeen: 42, newCandidates: 7 });
    expect(repository.listQueued()).toEqual([next]);
    expect(repository.hasSucceeded(search.id)).toBe(true);
  });

  it("persists schedules and recovers an interrupted run", () => {
    testDatabase = createTestDatabase();
    const search = createSearch(testDatabase);
    const repository = testDatabase.connection.scanRuns;
    const run = repository.enqueue(search.id, "startup", "2026-08-23T09:00:00.000Z");
    repository.markRunning(run.id, "2026-08-23T09:00:01.000Z");
    repository.recordSchedule(
      search.id,
      "2026-08-23T08:30:00.000Z",
      "2026-08-23T09:15:00.000Z",
      2
    );

    expect(repository.requeueInterrupted()).toBe(1);
    expect(repository.get(run.id)?.state).toBe("queued");
    expect(repository.listDue("2026-08-23T09:15:00.000Z")).toEqual([
      {
        searchId: search.id,
        lastScanAt: "2026-08-23T08:30:00.000Z",
        nextScanAt: "2026-08-23T09:15:00.000Z",
        consecutiveFailures: 2,
        updatedAt: "2026-08-23T08:30:00.000Z"
      }
    ]);

    testDatabase.connection.close();
    const reopened = openDatabase({ filename: testDatabase.filename });
    try {
      expect(reopened.scanRuns.get(run.id)?.state).toBe("queued");
      expect(reopened.scanRuns.getSchedule(search.id)?.nextScanAt)
        .toBe("2026-08-23T09:15:00.000Z");
    } finally {
      reopened.close();
    }
  });
});

function createSearch(testDatabase: TestDatabase) {
  const draft = createVehicleSearchDraft("Golf");
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  return testDatabase.connection.searches.create(draft);
}
