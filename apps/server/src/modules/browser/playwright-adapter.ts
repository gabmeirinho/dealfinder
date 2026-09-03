import { mkdir } from "node:fs/promises";

import { chromium, errors, type BrowserContext, type Page } from "playwright";

import type {
  BrowserAdapter,
  BrowserSession,
  MarketplacePageEvidence,
  MarketplaceResultSnapshot
} from "./adapter.js";

export const FACEBOOK_MARKETPLACE_ITEM_SELECTOR = [
  'a[href*="/marketplace/item/"]',
  'a[href*="/marketplace/np/item/"]',
  'a[href*="/marketplace/shops/item/"]'
].join(", ");
const FACEBOOK_RESULT_CARD_SELECTOR = [
  '[data-testid="marketplace-item-card"]',
  '[data-dealfinder-card="marketplace-item"]'
].join(", ");

const FACEBOOK_NAVIGATION_TIMEOUT_MS = 15_000;
const FACEBOOK_DETAIL_READY_TIMEOUT_MS = 15_000;
const FACEBOOK_RESULTS_TIMEOUT_MS = 15_000;
const FACEBOOK_SNAPSHOT_RETRY_ATTEMPTS = 10;
const FACEBOOK_SNAPSHOT_RETRY_DELAY_MS = 500;

export class FacebookNavigationError extends Error {
  public readonly code = "FACEBOOK_NAVIGATION_FAILED";

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FacebookNavigationError";
  }
}

export class FacebookSnapshotError extends Error {
  public readonly code = "FACEBOOK_SNAPSHOT_FAILED";

  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FacebookSnapshotError";
  }
}

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
    return await navigateMarketplacePage(this.#controlledPage, url);
  }

  public async navigateListing(url: string): Promise<string> {
    try {
      await this.#controlledPage.goto(url, {
        waitUntil: "commit",
        timeout: FACEBOOK_NAVIGATION_TIMEOUT_MS
      });
      await this.#controlledPage.waitForFunction(() => {
        const browser = globalThis as unknown as {
          document?: {
            body?: { innerText?: string };
            querySelector(selector: string): unknown;
          };
        };
        const bodyText = browser.document?.body?.innerText ?? "";
        return /(?:description|seller description|description du vendeur|descrição do vendedor|descripción del vendedor)/iu.test(bodyText) ||
          (browser.document !== undefined && browser.document.querySelector(
            '[data-testid*="description" i], [data-ad-preview="message"], [data-ad-comet-preview="message"]'
          ) !== null);
      }, { timeout: FACEBOOK_DETAIL_READY_TIMEOUT_MS }).catch(() => undefined);
      await this.expandListingDescription();
      await this.#controlledPage.waitForTimeout(500);
      return this.#controlledPage.url();
    } catch (error: unknown) {
      throw new FacebookNavigationError(
        "Facebook listing detail did not become ready",
        { cause: error }
      );
    }
  }

  public currentUrl(): string {
    return this.#controlledPage.url();
  }

  public onClosed(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public async snapshotMarketplaceResults(): Promise<MarketplaceResultSnapshot> {
    for (let attempt = 1; attempt <= FACEBOOK_SNAPSHOT_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const [cards, atEnd, title, bodyText, html, loadingCount] = await Promise.all([
          this.#controlledPage
            .locator(FACEBOOK_MARKETPLACE_ITEM_SELECTOR)
            .evaluateAll((anchors, cardSelector) => anchors.map((anchor) => {
              const card = anchor.closest(cardSelector);
              return card?.outerHTML ?? anchor.outerHTML;
            }), FACEBOOK_RESULT_CARD_SELECTOR),
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
      } catch (error: unknown) {
        if (attempt === FACEBOOK_SNAPSHOT_RETRY_ATTEMPTS || !isTransientPageReadError(error)) {
          throw new FacebookSnapshotError(
            "Facebook Marketplace could not be read after navigation",
            { cause: error }
          );
        }
        await this.#controlledPage.waitForTimeout(FACEBOOK_SNAPSHOT_RETRY_DELAY_MS);
      }
    }
    throw new FacebookSnapshotError("Facebook Marketplace could not be read after navigation");
  }

  public async snapshotListingDetail(): Promise<MarketplacePageEvidence> {
    const [title, bodyText, html] = await Promise.all([
      this.#controlledPage.title(),
      this.#controlledPage.locator("body").innerText().catch(() => ""),
      this.#controlledPage.content()
    ]);
    return {
      url: this.#controlledPage.url(),
      title,
      bodyText: bodyText.slice(0, 100_000),
      html,
      loading: false
    };
  }

  private async expandListingDescription(): Promise<void> {
    const expanders = this.#controlledPage
      .locator('[role="button"]')
      .filter({ hasText: /^(?:see more|ver mais|mostrar mais|voir plus|ver más)$/iu });
    const count = Math.min(await expanders.count(), 3);
    for (let index = 0; index < count; index += 1) {
      const expander = expanders.nth(index);
      if (!await expander.isVisible().catch(() => false)) continue;
      await expander.click().catch(() => undefined);
    }
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

export function isTransientPageReadError(error: unknown): boolean {
  if (error instanceof errors.TimeoutError) return true;
  const message = error instanceof Error ? error.message.toLocaleLowerCase("en") : "";
  return [
    "execution context was destroyed",
    "cannot find context with specified id",
    "because page is navigating",
    "most likely because of a navigation"
  ].some((fragment) => message.includes(fragment));
}

export async function navigateMarketplacePage(page: Page, url: string): Promise<string> {
  try {
    // Facebook renders Marketplace as a client-side application. Waiting for
    // DOMContentLoaded can exhaust Playwright's default timeout even after the
    // usable document has committed, so readiness is checked explicitly below.
    await page.goto(url, {
      waitUntil: "commit",
      timeout: FACEBOOK_NAVIGATION_TIMEOUT_MS
    });
    await submitMarketplaceSearch(page, url);
    await waitForMarketplaceResults(page);
    return page.url();
  } catch (error: unknown) {
    throw new FacebookNavigationError(
      "Facebook Marketplace did not become ready for scanning",
      { cause: error }
    );
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
  const pathSegments = url.pathname.toLocaleLowerCase("en").split("/").filter(Boolean);
  if (pathSegments.at(-1) !== "vehicles") return null;
  const query = url.searchParams.get("query")?.trim() ?? "";
  return query.length === 0 ? null : query;
}

async function waitForMarketplaceResults(page: Page): Promise<void> {
  try {
    await page.locator(FACEBOOK_MARKETPLACE_ITEM_SELECTOR).first().waitFor({
      state: "attached",
      timeout: FACEBOOK_RESULTS_TIMEOUT_MS
    });
  } catch (error: unknown) {
    // A card timeout can be a legitimate empty-results page. The scanner's
    // page classifier owns that distinction after navigation has settled.
    if (!(error instanceof errors.TimeoutError)) throw error;
  }
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}
