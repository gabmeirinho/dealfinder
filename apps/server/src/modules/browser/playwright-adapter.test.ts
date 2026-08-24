import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";

import {
  FACEBOOK_MARKETPLACE_ITEM_SELECTOR,
  FacebookNavigationError,
  isTransientPageReadError,
  marketplaceQueryFromUrl,
  navigateMarketplacePage
} from "./playwright-adapter.js";

describe("Playwright Marketplace navigation", () => {
  it("recognizes a generated Facebook Marketplace query that must be submitted", () => {
    expect(marketplaceQueryFromUrl(
      "https://www.facebook.com/marketplace/lisbon/vehicles/?query=Volkswagen+Golf&radius=150"
    )).toBe("Volkswagen Golf");
  });

  it("does not submit unrelated or queryless pages", () => {
    expect(marketplaceQueryFromUrl("https://www.facebook.com/marketplace/lisbon/vehicles/"))
      .toBeNull();
    expect(marketplaceQueryFromUrl("https://example.com/?query=Volkswagen+Golf"))
      .toBeNull();
    expect(marketplaceQueryFromUrl("not a URL")).toBeNull();
  });

  it("does not resubmit a query from an already verified search route", () => {
    expect(marketplaceQueryFromUrl(
      "https://www.facebook.com/marketplace/np/lisbon/search/?query=Volkswagen+Golf&radius=150"
    )).toBeNull();
  });

  it("recognizes current and legacy Marketplace item routes", () => {
    expect(FACEBOOK_MARKETPLACE_ITEM_SELECTOR).toContain('/marketplace/item/');
    expect(FACEBOOK_MARKETPLACE_ITEM_SELECTOR).toContain('/marketplace/np/item/');
    expect(FACEBOOK_MARKETPLACE_ITEM_SELECTOR).toContain('/marketplace/shops/item/');
  });

  it("waits only for the Facebook document commit before explicit readiness checks", async () => {
    const goto = vi.fn().mockResolvedValue(null);
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const page = {
      goto,
      locator: vi.fn().mockReturnValue({
        first: () => ({ waitFor })
      }),
      url: () => "https://www.facebook.com/marketplace/category/vehicles/"
    } as unknown as Page;

    await expect(navigateMarketplacePage(
      page,
      "https://www.facebook.com/marketplace/category/vehicles/"
    )).resolves.toBe("https://www.facebook.com/marketplace/category/vehicles/");
    expect(goto).toHaveBeenCalledWith(
      "https://www.facebook.com/marketplace/category/vehicles/",
      { waitUntil: "commit", timeout: 15_000 }
    );
    expect(waitFor).toHaveBeenCalledWith({ state: "attached", timeout: 15_000 });
  });

  it("loads a verified search route directly without resubmitting its query", async () => {
    const locator = vi.fn().mockReturnValue({
      first: () => ({ waitFor: vi.fn().mockResolvedValue(undefined) })
    });
    const page = {
      goto: vi.fn().mockResolvedValue(null),
      locator,
      url: () => "https://www.facebook.com/marketplace/np/lisbon/search/?query=Volkswagen+Golf"
    } as unknown as Page;

    await navigateMarketplacePage(
      page,
      "https://www.facebook.com/marketplace/np/lisbon/search/?query=Volkswagen+Golf"
    );

    expect(locator).toHaveBeenCalledTimes(1);
    expect(locator).toHaveBeenCalledWith(FACEBOOK_MARKETPLACE_ITEM_SELECTOR);
  });

  it("preserves a specific error code when Marketplace navigation fails", async () => {
    const page = {
      goto: vi.fn().mockRejectedValue(new Error("navigation timeout"))
    } as unknown as Page;

    await expect(navigateMarketplacePage(
      page,
      "https://www.facebook.com/marketplace/category/vehicles/"
    )).rejects.toMatchObject({
      code: "FACEBOOK_NAVIGATION_FAILED"
    } satisfies Partial<FacebookNavigationError>);
  });

  it("recognizes transient Playwright reads caused by an in-flight navigation", () => {
    expect(isTransientPageReadError(
      new Error("Unable to retrieve content because page is navigating")
    )).toBe(true);
    expect(isTransientPageReadError(
      new Error("Execution context was destroyed, most likely because of a navigation")
    )).toBe(true);
    expect(isTransientPageReadError(new Error("Invalid selector"))).toBe(false);
  });
});
