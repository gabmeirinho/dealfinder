import { mkdir } from "node:fs/promises";

import { chromium, type BrowserContext, type Page } from "playwright";

import type {
  BrowserAdapter,
  BrowserSession,
  MarketplaceResultSnapshot
} from "./adapter.js";

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

  public async navigate(url: string): Promise<string> {
    await this.#controlledPage.goto(url, { waitUntil: "domcontentloaded" });
    return this.#controlledPage.url();
  }

  public currentUrl(): string {
    return this.#controlledPage.url();
  }

  public onClosed(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public async snapshotMarketplaceResults(): Promise<MarketplaceResultSnapshot> {
    const [cards, atEnd, title, bodyText, html, loadingCount] = await Promise.all([
      this.#controlledPage
        .locator('a[href*="/marketplace/item/"]')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.outerHTML)),
      this.#controlledPage.evaluate(() => {
        const browser = globalThis as unknown as {
          scrollY: number;
          innerHeight: number;
          document: { documentElement: { scrollHeight: number } };
        };
        return browser.scrollY + browser.innerHeight >=
          browser.document.documentElement.scrollHeight - 4;
      }),
      this.#controlledPage.title(),
      this.#controlledPage.locator("body").innerText().catch(() => ""),
      this.#controlledPage.content(),
      this.#controlledPage.locator('[aria-busy="true"], [role="progressbar"]').count()
    ]);
    return {
      cards,
      atEnd,
      page: {
        url: this.#controlledPage.url(),
        title,
        bodyText: bodyText.slice(0, 100_000),
        html,
        loading: loadingCount > 0
      }
    };
  }

  public async scrollMarketplaceResults(): Promise<void> {
    await this.#controlledPage.evaluate(() => {
      const browser = globalThis as unknown as {
        scrollTo(x: number, y: number): void;
        document: { documentElement: { scrollHeight: number } };
      };
      browser.scrollTo(0, browser.document.documentElement.scrollHeight);
    });
    await this.#controlledPage.waitForTimeout(750);
  }

  public async captureDiagnosticScreenshot(): Promise<Uint8Array> {
    return await this.#controlledPage.screenshot({ type: "png", fullPage: false });
  }
}
