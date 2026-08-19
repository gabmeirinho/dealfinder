import { mkdir } from "node:fs/promises";

import { chromium, type BrowserContext, type Page } from "playwright";

import type { BrowserAdapter, BrowserSession } from "./adapter.js";

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  public async open(profileDirectory: string): Promise<BrowserSession> {
    await mkdir(profileDirectory, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDirectory, {
      headless: false
    });

    try {
      const pages = context.pages();
      const controlledPage = pages[0] ?? await context.newPage();
      for (const page of pages.slice(1)) await page.close();
      return new PlaywrightBrowserSession(context, controlledPage);
    } catch (error: unknown) {
      await context.close();
      throw error;
    }
  }
}

class PlaywrightBrowserSession implements BrowserSession {
  public readonly controlledTabs = 1 as const;
  readonly #listeners = new Set<() => void>();
  readonly #context: BrowserContext;
  readonly #controlledPage: Page;

  public constructor(context: BrowserContext, controlledPage: Page) {
    this.#context = context;
    this.#controlledPage = controlledPage;
    context.on("close", () => {
      for (const listener of this.#listeners) listener();
    });
    context.on("page", (page) => {
      if (page !== this.#controlledPage) void page.close().catch(() => undefined);
    });
  }

  public async close(): Promise<void> {
    await this.#context.close();
  }

  public onClosed(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
