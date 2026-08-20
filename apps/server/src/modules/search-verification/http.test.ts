import type { Server } from "node:http";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeHttpServer,
  createHttpServer,
  listenHttpServer
} from "../../app/http.js";
import {
  BrowserManager,
  type BrowserAdapter,
  type BrowserSession
} from "../browser/index.js";
import { SearchVerificationService } from "./service.js";

class FakeSession implements BrowserSession {
  public readonly controlledTabs = 1 as const;
  public url = "about:blank";
  readonly #listeners = new Set<() => void>();

  public async navigate(url: string): Promise<string> {
    this.url = url;
    return url;
  }

  public currentUrl(): string {
    return this.url;
  }

  public async close(): Promise<void> {
    for (const listener of this.#listeners) listener();
  }

  public onClosed(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

describe("search verification HTTP API", () => {
  let database: DatabaseConnection;
  let server: Server;
  let session: FakeSession;
  let baseUrl: string;

  beforeEach(async () => {
    database = openDatabase({ filename: ":memory:" });
    session = new FakeSession();
    const adapter: BrowserAdapter = { open: async () => session };
    const browser = new BrowserManager({ adapter, profileDirectory: "/fake-profile" });
    await browser.open();
    const verification = new SearchVerificationService({
      database: () => database,
      browser: () => browser,
      now: () => new Date("2026-08-20T12:00:00.000Z")
    });
    server = createHttpServer({
      database: () => database,
      browser: () => browser,
      searchVerification: () => verification
    });
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await closeHttpServer(server);
    database.close();
  });

  it("opens then confirms without accepting a URL in the request", async () => {
    const draft = createVehicleSearchDraft("Golf");
    draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    const search = database.searches.create(draft);

    const opened = await fetch(
      `${baseUrl}/api/searches/${search.id}/verification/facebook/open`,
      { method: "POST" }
    );
    expect(opened.status).toBe(202);
    expect(await opened.json()).toMatchObject({
      verification: { state: "pending", searchId: search.id }
    });
    expect(database.searchSources.get(search.id, "facebook")).toBeUndefined();

    session.url = "https://www.facebook.com/marketplace/category/vehicles/?query=Volkswagen";
    const confirmed = await fetch(
      `${baseUrl}/api/searches/${search.id}/verification/facebook/confirm`,
      { method: "POST" }
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      verification: { state: "verified", verifiedAt: "2026-08-20T12:00:00.000Z" }
    });
    expect(database.searchSources.get(search.id, "facebook")?.sourceUrl).toBe(session.url);
  });

  it("requires the controlled browser to be open", async () => {
    const draft = createVehicleSearchDraft("Volvo");
    draft.criteria.makeKeywords = { value: ["Volvo"], strength: "hard" };
    const search = database.searches.create(draft);
    await fetch(`${baseUrl}/api/browser/stop`, { method: "POST" });

    const response = await fetch(
      `${baseUrl}/api/searches/${search.id}/verification/facebook/open`,
      { method: "POST" }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "BROWSER_NOT_OPEN" }
    });
  });
});
