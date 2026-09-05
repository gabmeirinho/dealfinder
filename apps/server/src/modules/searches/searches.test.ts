import type { Server } from "node:http";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import {
  createVehicleSearchDraft,
  type VehicleSearchDraft
} from "@dealfinder/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeHttpServer,
  createHttpServer,
  listenHttpServer
} from "../../app/http.js";
import { fingerprintSearchCriteria } from "../search-verification/fingerprint.js";

describe("saved-search management API", () => {
  let database: DatabaseConnection;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    database = openDatabase({
      filename: ":memory:",
      now: () => new Date("2026-08-19T12:00:00.000Z")
    });
    server = createHttpServer({
      database: () => database,
      now: () => new Date("2026-08-19T12:30:00.000Z")
    });
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await closeHttpServer(server);
    database.close();
  });

  it("validates scan budgets, preserves them on pause, and keeps verification valid", async () => {
    const draft = searchDraft("Configured", 1);
    draft.scanLimits = { initialCardLimit: 500, knownListingStopCount: 100, maxCards: 1500, maxDurationSeconds: 180 };
    const created = await json(await api("/api/searches", { method: "POST", body: JSON.stringify(draft) }));
    expect(created.search.scanLimits).toEqual(draft.scanLimits);
    const before = fingerprintSearchCriteria(created.search);
    const updated = { ...draft, scanLimits: { ...draft.scanLimits, knownListingStopCount: 150 } };
    const saved = await json(await api(`/api/searches/${created.search.id}`, { method: "PUT", body: JSON.stringify(updated) }));
    expect(fingerprintSearchCriteria(saved.search)).toBe(before);
    expect((await json(await api(`/api/searches/${created.search.id}/pause`, { method: "POST" }))).search.scanLimits).toEqual(updated.scanLimits);
    for (const limits of [null, {}, { ...draft.scanLimits, maxCards: 20 }, { ...draft.scanLimits, maxDurationSeconds: 0 }]) {
      expect((await api("/api/searches", { method: "POST", body: JSON.stringify({ ...draft, scanLimits: limits }) })).status).toBe(422);
    }
    expect((await api(`/api/searches/${created.search.id}/scan`, { method: "POST", body: JSON.stringify({ mode: "unbounded" }) })).status).toBe(400);
  });

  it("creates independent canonical model targets and rolls back invalid or over-limit batches", async () => {
    const target = (make: string, model: string): VehicleSearchDraft => ({
      ...createVehicleSearchDraft(`${make} ${model}`),
      criteria: { ...createVehicleSearchDraft("").criteria, modelTarget: { strength: "hard", value: { make, model, variant: null } } }
    });
    const post = (searches: VehicleSearchDraft[], overrideActiveLimit = false) => api("/api/searches/models", { method: "POST", body: JSON.stringify({ searches, overrideActiveLimit }) });
    const created = await post([target("VW", "Golf"), target("SEAT", "Leon")]);
    expect(created.status).toBe(201);
    const body = await json(created);
    expect(body.searches).toHaveLength(2);
    expect(body.searches[0].criteria.modelTarget.value.make).toBe("Volkswagen");
    expect(body.searches[0].id).not.toBe(body.searches[1].id);
    expect(body.searches.every((search: { sourceVerification: { state: string } }) => search.sourceVerification.state === "unverified")).toBe(true);
    expect((await post([target("VW", "Golf"), target("Volkswagen", "Golf")])).status).toBe(400);
    expect((await post([target("Audi", "A1"), target("", "A3")])).status).toBe(422);
    expect(database.searches.list()).toHaveLength(2);
    for (let index = 0; index < 7; index++) database.searches.create(target("BMW", `Model ${index}`));
    expect((await post([target("Audi", "A1"), target("Audi", "A3")])).status).toBe(409);
    expect(database.searches.list()).toHaveLength(9);
    expect((await post([target("Audi", "A1"), target("Audi", "A3")], true)).status).toBe(201);
    expect(database.searches.list()).toHaveLength(11);
  });

  it("creates, lists, and reads searches with future-state placeholders", async () => {
    const createResponse = await api("/api/searches", {
      method: "POST",
      body: JSON.stringify(searchDraft("Golf search", 2))
    });
    expect(createResponse.status).toBe(201);
    const created = await json(createResponse);
    expect(created).toMatchObject({
      search: {
        name: "Golf search",
        active: true,
        lastScanAt: null,
        nextScanAt: null,
        sourceVerification: { state: "unverified", verifiedAt: null }
      }
    });
    const id = created.search.id as string;

    const listResponse = await api("/api/searches");
    expect(listResponse.status).toBe(200);
    expect(await json(listResponse)).toMatchObject({
      searches: [{ id, name: "Golf search" }]
    });

    const readResponse = await api(`/api/searches/${id}`);
    expect(readResponse.status).toBe(200);
    expect(await json(readResponse)).toEqual(created);
  });

  it("returns persisted last and next scan status", async () => {
    const search = database.searches.create(searchDraft("Scheduled Golf"));
    database.scanRuns.recordSchedule(
      search.id,
      "2026-08-19T12:15:00.000Z",
      "2026-08-19T12:45:00.000Z",
      0
    );

    const response = await api(`/api/searches/${search.id}`);

    expect(await json(response)).toMatchObject({
      search: {
        lastScanAt: "2026-08-19T12:15:00.000Z",
        nextScanAt: "2026-08-19T12:45:00.000Z"
      }
    });
  });

  it("updates persisted criteria and returns field validation errors", async () => {
    const created = database.searches.create(searchDraft("Original"));
    const update = searchDraft("Updated", 4);
    update.criteria.maximumMileageKm = { value: 80_000, strength: "soft" };

    const updateResponse = await api(`/api/searches/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(update)
    });
    expect(updateResponse.status).toBe(200);
    expect(await json(updateResponse)).toMatchObject({
      search: {
        id: created.id,
        name: "Updated",
        priority: 4,
        criteria: {
          maximumMileageKm: { value: 80_000, strength: "soft" }
        }
      }
    });
    expect(database.searches.get(created.id)?.name).toBe("Updated");

    update.criteria.priceRange = {
      value: { minimumEur: 30_000, maximumEur: 20_000 },
      strength: "hard"
    };
    const invalidResponse = await api(`/api/searches/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(update)
    });
    expect(invalidResponse.status).toBe(422);
    expect(await json(invalidResponse)).toMatchObject({
      error: {
        code: "SEARCH_VALIDATION_FAILED",
        fieldErrors: {
          "criteria.priceRange.maximumEur": expect.any(Array)
        }
      }
    });
    expect(database.searches.get(created.id)?.criteria.priceRange).toBeNull();
  });

  it("keeps non-criteria edits verified and marks changed criteria stale", async () => {
    const originalDraft = searchDraft("Verified Golf");
    const created = database.searches.create(originalDraft);
    database.searchSources.saveVerification({
      searchId: created.id,
      source: "facebook",
      sourceUrl: "https://www.facebook.com/marketplace/category/vehicles/?query=Golf",
      criteriaFingerprint: fingerprintSearchCriteria(created),
      verifiedAt: "2026-08-19T12:15:00.000Z"
    });

    const renamed = { ...originalDraft, name: "Renamed Golf", active: false };
    const renameResponse = await api(`/api/searches/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(renamed)
    });
    expect(await json(renameResponse)).toMatchObject({
      search: { sourceVerification: { state: "verified" } }
    });

    const changed = searchDraft("Renamed Golf");
    changed.active = false;
    changed.criteria.maximumMileageKm = { value: 90_000, strength: "hard" };
    const changedResponse = await api(`/api/searches/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(changed)
    });
    expect(await json(changedResponse)).toMatchObject({
      search: {
        sourceVerification: {
          state: "stale",
          verifiedAt: "2026-08-19T12:15:00.000Z"
        }
      }
    });
  });

  it("duplicates a resolved search in a paused state", async () => {
    const source = database.searches.create(searchDraft("Electric hatch"));

    const response = await api(`/api/searches/${source.id}/duplicate`, {
      method: "POST"
    });
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body).toMatchObject({
      search: {
        name: "Electric hatch copy",
        active: false,
        criteria: source.criteria,
        location: source.location
      }
    });
    expect(body.search.id).not.toBe(source.id);
  });

  it("pauses and activates while requiring confirmation for the eleventh active search", async () => {
    const activeSearches = Array.from({ length: 10 }, (_, index) =>
      database.searches.create(searchDraft(`Active ${index + 1}`, index + 1))
    );
    const paused = searchDraft("Paused", 11);
    paused.active = false;
    const eleventh = database.searches.create(paused);

    const warningResponse = await api(`/api/searches/${eleventh.id}/activate`, {
      method: "POST"
    });
    expect(warningResponse.status).toBe(409);
    expect(await json(warningResponse)).toEqual({
      error: {
        code: "ACTIVE_SEARCH_LIMIT_CONFIRMATION_REQUIRED",
        message: "Activating more than 10 searches requires confirmation",
        details: {
          activeCount: 10,
          activeLimit: 10,
          confirmationField: "overrideActiveLimit"
        }
      }
    });
    expect(database.searches.get(eleventh.id)?.active).toBe(false);

    const activationResponse = await api(`/api/searches/${eleventh.id}/activate`, {
      method: "POST",
      body: JSON.stringify({ overrideActiveLimit: true })
    });
    expect(activationResponse.status).toBe(200);
    expect(await json(activationResponse)).toMatchObject({ search: { active: true } });

    const pauseResponse = await api(`/api/searches/${activeSearches[0]?.id}/pause`, {
      method: "POST"
    });
    expect(pauseResponse.status).toBe(200);
    expect(await json(pauseResponse)).toMatchObject({ search: { active: false } });
  });

  it("applies the active limit to creation without silently inserting", async () => {
    for (let index = 0; index < 10; index += 1) {
      database.searches.create(searchDraft(`Active ${index + 1}`, index + 1));
    }

    const response = await api("/api/searches", {
      method: "POST",
      body: JSON.stringify(searchDraft("Needs confirmation", 11))
    });
    expect(response.status).toBe(409);
    expect(database.searches.list()).toHaveLength(10);

    const confirmedResponse = await api("/api/searches", {
      method: "POST",
      body: JSON.stringify({
        ...searchDraft("Confirmed", 11),
        overrideActiveLimit: true
      })
    });
    expect(confirmedResponse.status).toBe(201);
    expect(database.searches.list().filter(({ active }) => active)).toHaveLength(11);
  });

  it("reprioritizes the complete resolved search set atomically", async () => {
    const first = database.searches.create(searchDraft("First", 1));
    const second = database.searches.create(searchDraft("Second", 2));
    const third = database.searches.create(searchDraft("Third", 3));

    const response = await api("/api/searches/priorities", {
      method: "PUT",
      body: JSON.stringify({ searchIds: [third.id, first.id, second.id] })
    });
    expect(response.status).toBe(200);
    expect((await json(response)).searches.map((search: { id: string }) => search.id)).toEqual([
      third.id,
      first.id,
      second.id
    ]);
    expect(database.searches.list().map(({ priority }) => priority)).toEqual([1, 2, 3]);

    const staleResponse = await api("/api/searches/priorities", {
      method: "PUT",
      body: JSON.stringify({ searchIds: [first.id, second.id] })
    });
    expect(staleResponse.status).toBe(409);
    expect(await json(staleResponse)).toMatchObject({
      error: { code: "SEARCH_SET_CHANGED" }
    });
    expect(database.searches.list().map(({ id }) => id)).toEqual([
      third.id,
      first.id,
      second.id
    ]);
  });

  it("deletes only the resolved search and reports missing targets", async () => {
    const keep = database.searches.create(searchDraft("Keep", 1));
    const remove = database.searches.create(searchDraft("Remove", 2));

    const response = await api(`/api/searches/${remove.id}`, { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(database.searches.list().map(({ id }) => id)).toEqual([keep.id]);

    const repeatedResponse = await api(`/api/searches/${remove.id}`, {
      method: "DELETE"
    });
    expect(repeatedResponse.status).toBe(404);
    expect(await json(repeatedResponse)).toEqual({
      error: { code: "SEARCH_NOT_FOUND", message: "Saved search not found" }
    });
  });

  it("accepts manual scans only for active resolved searches", async () => {
    const active = database.searches.create(searchDraft("Scan me"));
    database.searchSources.saveVerification({
      searchId: active.id,
      source: "facebook",
      sourceUrl: "https://www.facebook.com/marketplace/category/vehicles/?query=Golf",
      criteriaFingerprint: fingerprintSearchCriteria(active),
      verifiedAt: "2026-08-19T12:15:00.000Z"
    });
    const response = await api(`/api/searches/${active.id}/scan`, { method: "POST" });
    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({
      runId: expect.any(String),
      searchId: active.id,
      status: "pending",
      requestedAt: "2026-08-19T12:30:00.000Z"
    });

    const deepResponse = await api(`/api/searches/${active.id}/scan`, { method: "POST", body: JSON.stringify({ mode: "deep" }) });
    expect(deepResponse.status).toBe(202);
    expect(database.scanRuns.listQueued()).toMatchObject([{ searchId: active.id, mode: "deep" }]);

    const pausedDraft = searchDraft("Paused");
    pausedDraft.active = false;
    const paused = database.searches.create(pausedDraft);
    const conflictResponse = await api(`/api/searches/${paused.id}/scan`, {
      method: "POST"
    });
    expect(conflictResponse.status).toBe(409);
    expect(await json(conflictResponse)).toMatchObject({
      error: { code: "SEARCH_INACTIVE" }
    });

    const unverified = database.searches.create(searchDraft("Unverified"));
    const unverifiedResponse = await api(`/api/searches/${unverified.id}/scan`, {
      method: "POST"
    });
    expect(unverifiedResponse.status).toBe(409);
    expect(await json(unverifiedResponse)).toMatchObject({
      error: { code: "SEARCH_NOT_VERIFIED" }
    });
  });

  it("rejects malformed requests with actionable errors and no echoed secrets", async () => {
    const response = await api("/api/searches", {
      method: "POST",
      body: JSON.stringify({ name: "bad", secretToken: "do-not-return" })
    });
    const bodyText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(bodyText)).toMatchObject({
      error: {
        code: "INVALID_REQUEST",
        fieldErrors: {
          priority: expect.any(Array),
          criteria: expect.any(Array),
          location: expect.any(Array)
        }
      }
    });
    expect(bodyText).not.toContain("do-not-return");
    expect(bodyText.toLowerCase()).not.toContain("token");
  });

  function api(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers
      }
    });
  }
});

function searchDraft(name: string, priority = 1): VehicleSearchDraft {
  const draft = createVehicleSearchDraft(name);
  draft.priority = priority;
  draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
  return draft;
}

async function json(response: Response): Promise<any> {
  return response.json();
}
