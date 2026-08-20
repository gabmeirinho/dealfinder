import type { BrowserAdapter, BrowserSession } from "../browser/index.js";
import { BrowserManager } from "../browser/index.js";
import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import { createVehicleSearchDraft } from "@dealfinder/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  SearchVerificationError,
  SearchVerificationService
} from "./service.js";

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

describe("Facebook search verification", () => {
  let database: DatabaseConnection | undefined;

  afterEach(() => database?.close());

  it("opens generated results and persists only the final URL after confirmation", async () => {
    const context = await createContext();
    const search = context.createSearch();

    const preview = await context.service.openFacebook(search.id);

    expect(preview).toMatchObject({
      searchId: search.id,
      source: "facebook",
      state: "pending"
    });
    expect(new URL(preview.generatedUrl).searchParams.get("query")).toBe("Volkswagen Golf");
    expect(context.database.searchSources.get(search.id, "facebook")).toBeUndefined();

    context.session.url = "https://www.facebook.com/marketplace/lisbon/vehicles/?query=Volkswagen%20Golf&radius=100";
    const confirmation = context.service.confirmFacebook(search.id);

    expect(confirmation).toEqual({
      searchId: search.id,
      source: "facebook",
      state: "verified",
      verifiedAt: "2026-08-20T12:00:00.000Z"
    });
    expect(context.database.searchSources.get(search.id, "facebook")).toMatchObject({
      sourceUrl: context.session.url,
      verifiedAt: confirmation.verifiedAt
    });
  });

  it("rejects without persisting and cannot confirm an unrelated page", async () => {
    const context = await createContext();
    const search = context.createSearch();
    await context.service.openFacebook(search.id);
    context.service.rejectFacebook(search.id);
    expect(context.database.searchSources.get(search.id, "facebook")).toBeUndefined();

    await context.service.openFacebook(search.id);
    context.session.url = "https://example.com/not-facebook";
    expect(() => context.service.confirmFacebook(search.id)).toThrowError(
      expect.objectContaining<Partial<SearchVerificationError>>({
        code: "FACEBOOK_RESULTS_NOT_VISIBLE"
      })
    );
    expect(context.database.searchSources.get(search.id, "facebook")).toBeUndefined();
  });

  it("invalidates a pending confirmation when relevant criteria change", async () => {
    const context = await createContext();
    const search = context.createSearch();
    await context.service.openFacebook(search.id);
    const edited = createVehicleSearchDraft("Golf renamed");
    edited.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
    edited.criteria.modelKeywords = { value: ["Golf", "Variant"], strength: "hard" };
    context.database.searches.update(search.id, edited);

    expect(() => context.service.confirmFacebook(search.id)).toThrowError(
      expect.objectContaining<Partial<SearchVerificationError>>({
        code: "SEARCH_CRITERIA_CHANGED"
      })
    );
  });

  async function createContext(): Promise<{
    database: DatabaseConnection;
    session: FakeSession;
    service: SearchVerificationService;
    createSearch(): ReturnType<DatabaseConnection["searches"]["create"]>;
  }> {
    database = openDatabase({ filename: ":memory:" });
    const session = new FakeSession();
    const adapter: BrowserAdapter = { open: async () => session };
    const browser = new BrowserManager({ adapter, profileDirectory: "/fake-profile" });
    await browser.open();
    const service = new SearchVerificationService({
      database: () => database!,
      browser: () => browser,
      now: () => new Date("2026-08-20T12:00:00.000Z")
    });
    return {
      database,
      session,
      service,
      createSearch: () => {
        const draft = createVehicleSearchDraft("Golf");
        draft.criteria.makeKeywords = { value: ["Volkswagen"], strength: "hard" };
        draft.criteria.modelKeywords = { value: ["Golf"], strength: "hard" };
        return database!.searches.create(draft);
      }
    };
  }
});
