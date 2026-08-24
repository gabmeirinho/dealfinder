import { mkdir } from "node:fs/promises";

import { chromium, type BrowserContext, type Page } from "playwright";

import type {
  BrowserAdapter,
  BrowserSession,
  MarketplaceResultSnapshot
} from "./adapter.js";

export const FACEBOOK_MARKETPLACE_ITEM_SELECTOR = [
  'a[href*="/marketplace/item/"]',
  'a[href*="/marketplace/np/item/"]',
  'a[href*="/marketplace/shops/item/"]'
].join(", ");

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
    await submitMarketplaceSearch(this.#controlledPage, url);
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
        .locator(FACEBOOK_MARKETPLACE_ITEM_SELECTOR)
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

async function submitMarketplaceSearch(page: Page, requestedUrl: string): Promise<void> {
  const expectedQuery = marketplaceQueryFromUrl(requestedUrl);
  if (expectedQuery === null) return;

  try {
    await page.waitForFunction((query) => {
      const expected = String(query).trim().toLocaleLowerCase("en");
      const browser = globalThis as unknown as {
        document: { querySelectorAll(selector: string): ArrayLike<{ value: string }> };
      };
      return Array.from(browser.document.querySelectorAll("input"))
        .some((input) => input.value.trim().toLocaleLowerCase("en") === expected);
    }, expectedQuery, { timeout: 10_000 });
  } catch {
    throw new Error("Facebook did not load the generated Marketplace search query");
  }

  const inputs = page.locator("input");
  for (let index = 0; index < await inputs.count(); index += 1) {
    const input = inputs.nth(index);
    const value = await input.inputValue().catch(() => "");
    if (normalizeQuery(value) !== normalizeQuery(expectedQuery)) continue;
    await input.waitFor({ state: "visible" });
    await page.waitForTimeout(1_500);
    await input.click();
    await input.press("Control+A");
    await input.type(expectedQuery, { delay: 25 });
    await input.press("Enter");
    await page.waitForTimeout(2_000);
    return;
  }
  throw new Error("Facebook did not expose the generated Marketplace search input");
}

export function marketplaceQueryFromUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const isFacebook = url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com");
  if (!isFacebook || !url.pathname.toLocaleLowerCase("en").startsWith("/marketplace/")) {
    return null;
  }
  const query = url.searchParams.get("query")?.trim() ?? "";
  return query.length === 0 ? null : query;
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}
