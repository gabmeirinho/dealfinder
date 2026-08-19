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
    const response = await api(`/api/searches/${active.id}/scan`, { method: "POST" });
    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({
      searchId: active.id,
      status: "pending",
      requestedAt: "2026-08-19T12:30:00.000Z"
    });

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
