import type { DatabaseConnection } from "@dealfinder/db";
import type {
  SearchVerificationConfirmation,
  SearchVerificationPreview,
  SearchVerificationRejection,
  VehicleSearch
} from "@dealfinder/domain";

import type { BrowserManager } from "../browser/index.js";
import { buildFacebookVehicleSearch } from "../../sources/facebook/search-builder/index.js";
import { fingerprintSearchCriteria } from "./fingerprint.js";

interface PendingVerification {
  searchId: string;
  criteriaFingerprint: string;
  preview: SearchVerificationPreview;
}

export interface SearchVerificationServiceOptions {
  database: () => DatabaseConnection;
  browser: () => BrowserManager;
  now?: () => Date;
}

export class SearchVerificationError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SearchVerificationError";
  }
}

export class SearchVerificationService {
  readonly #database: () => DatabaseConnection;
  readonly #browser: () => BrowserManager;
  readonly #now: () => Date;
  #pending: PendingVerification | undefined;

  public constructor(options: SearchVerificationServiceOptions) {
    this.#database = options.database;
    this.#browser = options.browser;
    this.#now = options.now ?? (() => new Date());
  }

  public async openFacebook(searchId: string): Promise<SearchVerificationPreview> {
    const search = this.requireSearch(searchId);
    const build = buildFacebookVehicleSearch(search);
    await this.#browser().navigate(build.url);
    const preview: SearchVerificationPreview = {
      searchId,
      source: "facebook",
      state: "pending",
      generatedUrl: build.url,
      supportedFilters: build.supportedFilters,
      postFilters: build.postFilters
    };
    this.#pending = {
      searchId,
      criteriaFingerprint: fingerprintSearchCriteria(search),
      preview
    };
    return preview;
  }

  public confirmFacebook(searchId: string): SearchVerificationConfirmation {
    const pending = this.requirePending(searchId);
    const search = this.requireSearch(searchId);
    const fingerprint = fingerprintSearchCriteria(search);
    if (fingerprint !== pending.criteriaFingerprint) {
      this.#pending = undefined;
      throw new SearchVerificationError(
        409,
        "SEARCH_CRITERIA_CHANGED",
        "The search changed after Facebook was opened; start verification again"
      );
    }

    const finalUrl = requireFacebookMarketplaceUrl(this.#browser().currentUrl());
    const verifiedAt = this.#now().toISOString();
    this.#database().searchSources.saveVerification({
      searchId,
      source: "facebook",
      sourceUrl: finalUrl,
      criteriaFingerprint: fingerprint,
      verifiedAt
    });
    this.#pending = undefined;
    return { searchId, source: "facebook", state: "verified", verifiedAt };
  }

  public rejectFacebook(searchId: string): SearchVerificationRejection {
    this.requirePending(searchId);
    this.#pending = undefined;
    return { searchId, source: "facebook", state: "rejected" };
  }

  private requireSearch(searchId: string): VehicleSearch {
    const search = this.#database().searches.get(searchId);
    if (search === undefined) {
      throw new SearchVerificationError(404, "SEARCH_NOT_FOUND", "Saved search not found");
    }
    return search;
  }

  private requirePending(searchId: string): PendingVerification {
    if (this.#pending?.searchId !== searchId) {
      throw new SearchVerificationError(
        409,
        "VERIFICATION_NOT_PENDING",
        "Open this search in Facebook before confirming or rejecting it"
      );
    }
    return this.#pending;
  }
}

export function requireFacebookMarketplaceUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalidResultsPage();
  }
  const isFacebook = url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com");
  if (
    url.protocol !== "https:" ||
    !isFacebook ||
    !url.pathname.toLocaleLowerCase("en").startsWith("/marketplace/")
  ) {
    throw invalidResultsPage();
  }
  url.hash = "";
  return url.toString();
}

function invalidResultsPage(): SearchVerificationError {
  return new SearchVerificationError(
    409,
    "FACEBOOK_RESULTS_NOT_VISIBLE",
    "Keep the controlled browser on the intended Facebook Marketplace results before confirming"
  );
}
