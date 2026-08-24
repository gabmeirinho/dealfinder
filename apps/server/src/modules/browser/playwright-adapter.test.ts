import { describe, expect, it } from "vitest";

import {
  FACEBOOK_MARKETPLACE_ITEM_SELECTOR,
  marketplaceQueryFromUrl
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

  it("recognizes current and legacy Marketplace item routes", () => {
    expect(FACEBOOK_MARKETPLACE_ITEM_SELECTOR).toContain('/marketplace/item/');
    expect(FACEBOOK_MARKETPLACE_ITEM_SELECTOR).toContain('/marketplace/np/item/');
    expect(FACEBOOK_MARKETPLACE_ITEM_SELECTOR).toContain('/marketplace/shops/item/');
  });
});
