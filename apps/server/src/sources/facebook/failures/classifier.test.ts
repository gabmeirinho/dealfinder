import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { MarketplaceResultSnapshot } from "../../../modules/browser/index.js";
import { classifyFacebookPage } from "./classifier.js";

const cases = [
  ["checkpoint.html", "checkpoint", "browser", "https://www.facebook.com/checkpoint/123", false, 0],
  ["login.html", "login_required", "browser", "https://www.facebook.com/login/", false, 0],
  ["restricted.html", "marketplace_restricted", "browser", "https://www.facebook.com/marketplace/", false, 0],
  ["consent.html", "consent_required", "browser", "https://www.facebook.com/privacy/consent/", false, 0],
  ["rate-limit.html", "rate_limited", "source", "https://www.facebook.com/marketplace/", false, 0],
  ["empty.html", "empty_results", "search", "https://www.facebook.com/marketplace/", false, 0],
  ["partial.html", "partial_load", "search", "https://www.facebook.com/marketplace/", true, 2],
  ["selector.html", "partial_load", "search", "https://www.facebook.com/marketplace/", false, 2]
] as const;

describe("Facebook failure classification", () => {
  it("does not mistake the captured blank Facebook shell for a source-wide selector failure", () => {
    const snapshot: MarketplaceResultSnapshot = {
      cards: [], atEnd: true,
      page: { url: "https://www.facebook.com/marketplace/lisbon/vehicles/", title: "Facebook", bodyText: "", html: "<html><body><div></div></body></html>", loading: false }
    };
    expect(classifyFacebookPage(snapshot, { unchangedSnapshots: 0 })).toBeNull();
    expect(classifyFacebookPage(snapshot, { unchangedSnapshots: 2 })).toMatchObject({ kind: "partial_load", scope: "search" });
  });

  it.each(cases)("classifies %s", (file, kind, scope, url, loading, unchangedSnapshots) => {
    const html = fixture(file);
    const snapshot: MarketplaceResultSnapshot = {
      cards: [],
      atEnd: file === "selector.html",
      page: {
        url,
        title: "Facebook",
        bodyText: text(html),
        html,
        loading
      }
    };

    expect(classifyFacebookPage(snapshot, { unchangedSnapshots })).toMatchObject({
      kind,
      scope
    });
  });
});

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(
    `../../../../test/fixtures/facebook/failures/${name}`,
    import.meta.url
  )), "utf8");
}

function text(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}
