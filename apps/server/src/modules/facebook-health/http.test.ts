import type { Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";

import {
  closeHttpServer,
  createHttpServer,
  listenHttpServer
} from "../../app/http.js";
import { BrowserManager, type BrowserAdapter } from "../browser/index.js";
import { ScanScheduler } from "../scheduler/index.js";
import { FacebookHealthService } from "./service.js";

describe("Facebook acquisition health API", () => {
  let database: DatabaseConnection;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    database = openDatabase({ filename: ":memory:" });
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);
    database.facebookHealth.pause({
      scope: "search",
      scopeKey: search.id,
      searchId: search.id,
      failureKind: "empty_results",
      detail: "Facebook explicitly returned no Marketplace listings",
      diagnosticId: null,
      pausedAt: "2026-08-23T09:00:00.000Z"
    });
    const browser = new BrowserManager({
      adapter: { open: async () => { throw new Error("not used"); } } satisfies BrowserAdapter,
      profileDirectory: "/unused"
    });
    const scheduler = new ScanScheduler({
      database: () => database,
      scanner: { scan: async () => ({
        cardsSeen: 0,
        newCandidates: 0,
        initialScan: true,
        stopReason: "results_end"
      }) }
    });
    const health = new FacebookHealthService({
      database: () => database,
      browser: () => browser,
      scheduler: () => scheduler,
      now: () => new Date("2026-08-23T10:00:00.000Z")
    });
    server = createHttpServer({ database: () => database, facebookHealth: () => health });
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await closeHttpServer(server);
    database.close();
  });

  it("exposes failure details and resolves only the requested pause", async () => {
    const statusResponse = await fetch(`${baseUrl}/api/facebook-health`);
    const status = await statusResponse.json() as {
      facebook: { status: string; pauses: Array<{ id: string }> };
    };
    expect(status).toMatchObject({
      facebook: {
        status: "paused",
        diagnosticsRetentionDays: 7,
        automaticSelectorRepair: false,
        screenshotsExternal: false
      }
    });

    const resumeResponse = await fetch(
      `${baseUrl}/api/facebook-health/pauses/${status.facebook.pauses[0]?.id}/resume`,
      { method: "POST" }
    );

    expect(resumeResponse.status).toBe(200);
    expect(await resumeResponse.json()).toMatchObject({
      facebook: { status: "ok", pauses: [] }
    });
  });
});
