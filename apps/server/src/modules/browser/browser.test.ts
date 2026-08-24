import { describe, expect, it } from "vitest";

import type { BrowserAdapter, BrowserSession } from "./adapter.js";
import { BrowserCommandError, BrowserManager } from "./manager.js";

class FakeBrowserSession implements BrowserSession {
  public readonly controlledTabs = 1 as const;
  public closed = false;
  public url = "about:blank";
  readonly #listeners = new Set<() => void>();

  public async close(): Promise<void> {
    this.closed = true;
    for (const listener of this.#listeners) listener();
  }

  public async navigate(url: string): Promise<string> {
    this.url = url;
    return url;
  }

  public currentUrl(): string {
    return this.url;
  }

  public onClosed(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public closeWindow(): void {
    this.closed = true;
    for (const listener of this.#listeners) listener();
  }
}

class FakeBrowserAdapter implements BrowserAdapter {
  public readonly openedProfiles: string[] = [];
  public readonly sessions: FakeBrowserSession[] = [];
  public readonly authenticatedProfiles = new Set<string>();

  public async open(profileDirectory: string): Promise<BrowserSession> {
    this.openedProfiles.push(profileDirectory);
    const session = new FakeBrowserSession();
    this.sessions.push(session);
    return session;
  }
}

describe("managed browser", () => {
  it("reuses the dedicated profile after an application restart", async () => {
    const adapter = new FakeBrowserAdapter();
    const profileDirectory = "/data/dealfinder/browser-profile";
    const firstRuntime = new BrowserManager({ adapter, profileDirectory });

    await firstRuntime.open();
    adapter.authenticatedProfiles.add(profileDirectory);
    await firstRuntime.shutdown();

    const restartedRuntime = new BrowserManager({ adapter, profileDirectory });
    expect(restartedRuntime.getStatus().state).toBe("stopped");
    await restartedRuntime.open();

    expect(adapter.openedProfiles).toEqual([profileDirectory, profileDirectory]);
    expect(adapter.authenticatedProfiles.has(adapter.openedProfiles[1] ?? "")).toBe(true);
  });

  it("pauses when the user closes the visible window and requires resume", async () => {
    const adapter = new FakeBrowserAdapter();
    const browser = new BrowserManager({ adapter, profileDirectory: "/profile" });
    await browser.open();

    adapter.sessions[0]?.closeWindow();

    expect(browser.getStatus()).toMatchObject({
      state: "paused",
      attentionReason: "browser_closed",
      controlledTabs: 0
    });
    await expect(browser.open()).rejects.toMatchObject({
      code: "BROWSER_RESUME_REQUIRED"
    } satisfies Partial<BrowserCommandError>);

    await browser.resume();
    expect(browser.getStatus()).toMatchObject({ state: "open", controlledTabs: 1 });
    expect(adapter.sessions).toHaveLength(2);
  });

  it.each(["login_required", "marketplace_denied", "checkpoint", "consent_required"] as const)(
    "closes and pauses for %s until explicitly resumed",
    async (reason) => {
      const adapter = new FakeBrowserAdapter();
      const browser = new BrowserManager({ adapter, profileDirectory: "/profile" });
      await browser.open();

      await browser.pauseForAttention(reason);

      expect(adapter.sessions[0]?.closed).toBe(true);
      expect(browser.getStatus()).toMatchObject({ state: "paused", attentionReason: reason });
      await browser.resume();
      expect(browser.getStatus().state).toBe("open");
    }
  );

  it("stops intentionally without creating an attention state", async () => {
    const adapter = new FakeBrowserAdapter();
    const browser = new BrowserManager({ adapter, profileDirectory: "/profile" });
    await browser.open();

    await browser.stop();

    expect(browser.getStatus()).toMatchObject({
      state: "stopped",
      attentionReason: null,
      controlledTabs: 0
    });
  });
});
