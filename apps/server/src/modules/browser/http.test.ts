import { openDatabase } from "@dealfinder/db";
import { afterEach, describe, expect, it } from "vitest";

import { closeHttpServer, createHttpServer, listenHttpServer } from "../../app/http.js";
import type { BrowserAdapter, BrowserSession } from "./adapter.js";
import { BrowserManager } from "./manager.js";

class FakeSession implements BrowserSession {
  public readonly controlledTabs = 1 as const;
  readonly #listeners = new Set<() => void>();

  public async close(): Promise<void> {
    for (const listener of this.#listeners) listener();
  }

  public onClosed(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

describe("browser HTTP controls", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const action of cleanup.splice(0).reverse()) await action();
  });

  it("opens, reports, and stops the controlled browser through local endpoints", async () => {
    const database = openDatabase({ filename: ":memory:" });
    const adapter: BrowserAdapter = { open: async () => new FakeSession() };
    const browser = new BrowserManager({
      adapter,
      profileDirectory: "/profile",
      now: () => new Date("2026-02-03T04:05:06.000Z")
    });
    const server = createHttpServer({
      database: () => database,
      browser: () => browser
    });
    cleanup.push(() => database.close(), () => closeHttpServer(server));
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${address.port}/api/browser`;

    const opened = await fetch(`${base}/open`, { method: "POST" });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({
      browser: {
        state: "open",
        attentionReason: null,
        attentionDetail: null,
        changedAt: "2026-02-03T04:05:06.000Z",
        profilePersistent: true,
        controlledTabs: 1
      }
    });

    const status = await fetch(base);
    expect((await status.json() as { browser: { state: string } }).browser.state).toBe("open");

    const stopped = await fetch(`${base}/stop`, { method: "POST" });
    expect((await stopped.json() as { browser: { state: string } }).browser.state).toBe("stopped");
  });

  it("rejects open while attention requires explicit resume", async () => {
    const database = openDatabase({ filename: ":memory:" });
    const adapter: BrowserAdapter = { open: async () => new FakeSession() };
    const browser = new BrowserManager({ adapter, profileDirectory: "/profile" });
    await browser.pauseForAttention("login_required");
    const server = createHttpServer({
      database: () => database,
      browser: () => browser
    });
    cleanup.push(() => database.close(), () => closeHttpServer(server));
    const address = await listenHttpServer(server, { host: "127.0.0.1", port: 0 });

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/browser/open`,
      { method: "POST" }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "BROWSER_RESUME_REQUIRED" }
    });
  });
});
