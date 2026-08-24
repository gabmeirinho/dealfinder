import type { DatabaseConnection } from "@dealfinder/db";
import {
  INITIAL_SCAN_CARD_LIMIT,
  KNOWN_LISTING_STOP_COUNT
} from "@dealfinder/domain";

import type { MarketplaceResultSnapshot } from "../../../modules/browser/index.js";
import { ListingIngestionService } from "../../../modules/listings/index.js";
import {
  GeocodingService,
  type GeocodingProvider
} from "../../../modules/geocoding/index.js";
import { fingerprintSearchCriteria } from "../../../modules/search-verification/fingerprint.js";
import {
  classifyFacebookPage,
  FacebookAcquisitionPausedError,
  selectorContractFailure,
  type FacebookPageFailure
} from "../failures/index.js";
import {
  FacebookResultContractError,
  parseFacebookResultPage,
  type FacebookRawCandidate,
  type FacebookResultPage
} from "../parser/index.js";

export interface FacebookScanResult {
  cardsSeen: number;
  newCandidates: number;
  initialScan: boolean;
  stopReason: "initial_limit" | "known_streak" | "results_end" | "no_progress";
}

const MIN_CARDS_FOR_PARTIAL_TOLERANCE = 10;
const MAX_REJECTED_CARD_RATIO = 0.1;

export interface FacebookScanBrowser {
  navigate(url: string): Promise<string>;
  snapshotMarketplaceResults(): Promise<MarketplaceResultSnapshot>;
  scrollMarketplaceResults(): Promise<void>;
}

export interface FacebookScannerOptions {
  database: () => DatabaseConnection;
  browser: () => FacebookScanBrowser;
  now?: () => Date;
  failures?: {
    pause(
      searchId: string,
      failure: FacebookPageFailure,
      snapshot: MarketplaceResultSnapshot
    ): Promise<{ id: string }>;
  };
  geocodingProvider?: GeocodingProvider;
  processingWake?: () => void;
  onStageError?: (input: {
    phase: "navigation" | "snapshot" | "parsing" | "scroll" | "ingestion";
    error: unknown;
  }) => void;
}

export class FacebookScanner {
  readonly #database: () => DatabaseConnection;
  readonly #browser: () => FacebookScanBrowser;
  readonly #now: () => Date;
  readonly #failures: FacebookScannerOptions["failures"];
  readonly #geocodingProvider: GeocodingProvider | undefined;
  readonly #processingWake: (() => void) | undefined;
  readonly #onStageError: FacebookScannerOptions["onStageError"];

  public constructor(options: FacebookScannerOptions) {
    this.#database = options.database;
    this.#browser = options.browser;
    this.#now = options.now ?? (() => new Date());
    this.#failures = options.failures;
    this.#geocodingProvider = options.geocodingProvider;
    this.#processingWake = options.processingWake;
    this.#onStageError = options.onStageError;
  }

  public async scan(searchId: string): Promise<FacebookScanResult> {
    const database = this.#database();
    const search = database.searches.get(searchId);
    if (search === undefined) throw new FacebookScannerError("SEARCH_NOT_FOUND", "Saved search not found");
    if (!search.active) throw new FacebookScannerError("SEARCH_INACTIVE", "Saved search is paused");
    const verification = database.searchSources.get(searchId, "facebook");
    if (verification === undefined) {
      throw new FacebookScannerError("SEARCH_UNVERIFIED", "Verify this search in Facebook before scanning");
    }
    if (verification.criteriaFingerprint !== fingerprintSearchCriteria(search)) {
      throw new FacebookScannerError(
        "SEARCH_VERIFICATION_STALE",
        "Search criteria changed; verify the Facebook results again before scanning"
      );
    }

    let phase: "navigation" | "snapshot" | "parsing" | "scroll" | "ingestion" = "navigation";
    try {
      const initialScan = !database.scanRuns.hasSucceeded(searchId);
      const observedAt = this.#now().toISOString();
      const browser = this.#browser();
      await browser.navigate(verification.sourceUrl);
      const seenThisScan = new Set<string>();
      const staged: FacebookRawCandidate[] = [];
      let cardsSeen = 0;
      let newCandidates = 0;
      let consecutiveKnown = 0;
      let unchangedSnapshots = 0;

      while (true) {
        phase = "snapshot";
        const snapshot = await browser.snapshotMarketplaceResults();
        let newIdsInSnapshot = 0;
        const classified = classifyFacebookPage(snapshot, { unchangedSnapshots });
        if (classified !== null) await this.pause(searchId, classified, snapshot);
        if (snapshot.cards.length > 0) {
          phase = "parsing";
          let parsed: FacebookResultPage;
          try {
            parsed = parseFacebookResultPage(wrapCards(snapshot.cards));
          } catch (error: unknown) {
            if (error instanceof FacebookResultContractError) {
              await this.pause(searchId, selectorContractFailure(), snapshot);
            }
            throw error;
          }
          if (hasUnsafeRejectedCards(parsed)) {
            await this.pause(searchId, selectorContractFailure(), snapshot);
          }
          for (const candidate of parsed.candidates) {
            if (seenThisScan.has(candidate.sourceListingId)) continue;
            seenThisScan.add(candidate.sourceListingId);
            newIdsInSnapshot += 1;
            cardsSeen += 1;
            const known = database.rawCandidates.get("facebook", candidate.sourceListingId) !== undefined;
            staged.push(candidate);
            if (known) consecutiveKnown += 1;
            else {
              consecutiveKnown = 0;
              newCandidates += 1;
            }

            if (initialScan && cardsSeen >= INITIAL_SCAN_CARD_LIMIT) {
              phase = "ingestion";
              return await this.commit(searchId, observedAt, staged, {
                cardsSeen, newCandidates, initialScan, stopReason: "initial_limit"
              });
            }
            if (!initialScan && consecutiveKnown >= KNOWN_LISTING_STOP_COUNT) {
              phase = "ingestion";
              return await this.commit(searchId, observedAt, staged, {
                cardsSeen, newCandidates, initialScan, stopReason: "known_streak"
              });
            }
          }
        }

        const nextUnchangedSnapshots = newIdsInSnapshot === 0 ? unchangedSnapshots + 1 : 0;
        const stalledFailure = classifyFacebookPage(snapshot, {
          unchangedSnapshots: nextUnchangedSnapshots
        });
        if (stalledFailure !== null) await this.pause(searchId, stalledFailure, snapshot);

        if (snapshot.atEnd) {
          phase = "ingestion";
          return await this.commit(searchId, observedAt, staged, {
            cardsSeen, newCandidates, initialScan, stopReason: "results_end"
          });
        }
        unchangedSnapshots = nextUnchangedSnapshots;
        if (unchangedSnapshots >= 3) {
          phase = "ingestion";
          return await this.commit(searchId, observedAt, staged, {
            cardsSeen, newCandidates, initialScan, stopReason: "no_progress"
          });
        }
        phase = "scroll";
        await browser.scrollMarketplaceResults();
      }
    } catch (error: unknown) {
      if (hasErrorCode(error)) throw error;
      this.#onStageError?.({ phase, error });
      throw new FacebookScannerError(
        `FACEBOOK_${phase.toLocaleUpperCase("en")}_FAILED`,
        `Facebook scan failed during ${phase}`,
        { cause: error }
      );
    }
  }

  private async commit(
    searchId: string,
    observedAt: string,
    candidates: readonly FacebookRawCandidate[],
    result: FacebookScanResult
  ): Promise<FacebookScanResult> {
    const database = this.#database();
    const ingestion = new ListingIngestionService(() => database).ingestScan({
      searchId,
      observedAt,
      initialScan: result.initialScan,
      completeSnapshot: result.stopReason === "results_end",
      candidates
    });
    this.#processingWake?.();
    const geocoding = new GeocodingService({
      database: () => database,
      ...(this.#geocodingProvider === undefined ? {} : { provider: this.#geocodingProvider })
    });
    const search = database.searches.get(searchId);
    if (search === undefined) throw new Error(`Search not found after listing ingestion: ${searchId}`);
    for (const [index, listing] of ingestion.listings.entries()) {
      await geocoding.calculate({
        listingId: listing.id,
        searchId,
        searchLocation: search.location,
        listingLocality: candidates[index]?.location ?? null,
        calculatedAt: observedAt
      });
    }
    return result;
  }

  private async pause(
    searchId: string,
    failure: FacebookPageFailure,
    snapshot: MarketplaceResultSnapshot
  ): Promise<never> {
    if (this.#failures === undefined) {
      throw new FacebookAcquisitionPausedError(failure, "unpersisted");
    }
    const pause = await this.#failures.pause(searchId, failure, snapshot);
    throw new FacebookAcquisitionPausedError(failure, pause.id);
  }
}

function hasErrorCode(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null &&
    "code" in error && typeof error.code === "string";
}

function hasUnsafeRejectedCards(page: FacebookResultPage): boolean {
  const rejected = page.rejectedCards.length;
  if (rejected === 0) return false;
  const total = page.candidates.length + rejected;
  if (total < MIN_CARDS_FOR_PARTIAL_TOLERANCE) return true;
  return rejected / total > MAX_REJECTED_CARD_RATIO;
}

export class FacebookScannerError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "FacebookScannerError";
  }
}

function wrapCards(cards: readonly string[]): string {
  return `<main data-dealfinder-results-contract="1">${cards
    .map((card) => `<article data-dealfinder-card="marketplace-item">${card}</article>`)
    .join("")}</main>`;
}
