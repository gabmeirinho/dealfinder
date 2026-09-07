import type { DatabaseConnection } from "@dealfinder/db";
import type {
  ListingDetailFactValues,
  ListingDetailStructuredFacts
} from "@dealfinder/db";
import {
  applyFactCorrections,
  applyReusableRules,
  assessVehicleRisk,
  evaluateVehicleMatch,
  normalizeVehicleFacts,
  type StructuredVehicleFacts
} from "@dealfinder/domain";

import { canonicalStandvirtualDetailUrl, parseStandvirtualDetail, StandvirtualDetailError } from "../../../sources/standvirtual/detail-parser.js";
import { DealScoringService } from "../../scoring/service.js";

import type { BrowserManager } from "../../browser/index.js";
import {
  parseFacebookListingDetail
} from "../../../sources/facebook/detail-parser/index.js";

export interface ListingDetailCaptureServiceOptions {
  database: () => DatabaseConnection;
  browser: () => BrowserManager;
  processingWake?: () => void;
  now?: () => Date;
}

export interface ListingDetailCaptureResult {
  listingId: number;
  description: string | null;
  capturedAt: string;
  queuedForEnrichment: boolean;
}

export interface ListingDetailCaptureBatchResult {
  searchId: string;
  attempted: number;
  succeeded: number;
  failed: number;
  blocked: boolean;
}

export const DETAIL_CAPTURE_BATCH_SIZE = 5 as const;
const DETAIL_CAPTURE_SUCCESS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const DETAIL_CAPTURE_FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export class ListingDetailCaptureService {
  readonly #database: () => DatabaseConnection;
  readonly #browser: () => BrowserManager;
  readonly #processingWake: (() => void) | undefined;
  readonly #now: () => Date;
  #captureTail: Promise<void> = Promise.resolve();
  #recovered = false;

  public constructor(options: ListingDetailCaptureServiceOptions) {
    this.#database = options.database;
    this.#browser = options.browser;
    this.#processingWake = options.processingWake;
    this.#now = options.now ?? (() => new Date());
  }

  public async capture(listingId: number): Promise<ListingDetailCaptureResult> {
    return await this.withCaptureLock(() => this.captureWithAttempt(listingId));
  }

  /** Captures a small, ordered batch after a search scan without flooding Facebook. */
  public async captureEligible(
    searchId: string,
    limit: number = DETAIL_CAPTURE_BATCH_SIZE,
    source: "facebook" | "standvirtual" = "facebook"
  ): Promise<ListingDetailCaptureBatchResult> {
    return await this.withCaptureLock(() => this.captureEligibleWithLock(searchId, limit, source));
  }

  private async captureEligibleWithLock(
    searchId: string,
    limit: number,
    source: "facebook" | "standvirtual"
  ): Promise<ListingDetailCaptureBatchResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw new Error("Detail capture batch size must be an integer from 1 to 25");
    }
    const database = this.#database();
    if (database.searches.get(searchId) === undefined) throw new Error(`Search not found: ${searchId}`);
    const now = this.#now().toISOString();
    database.listingDetailCaptureAttempts.recoverInterrupted(
      now,
      offsetTimestamp(now, DETAIL_CAPTURE_FAILURE_COOLDOWN_MS)
    );
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let blocked = false;
    while (attempted < limit) {
      const at = this.#now().toISOString();
      const listingId = database.listingDetailCaptureAttempts.findNextEligible(
        searchId,
        at,
        offsetTimestamp(at, -DETAIL_CAPTURE_SUCCESS_COOLDOWN_MS), source
      );
      if (listingId === undefined) break;
      attempted += 1;
      try {
        await this.captureWithAttempt(listingId);
        succeeded += 1;
      } catch (error: unknown) {
        failed += 1;
        if (isBrowserUnavailable(error)) {
          blocked = true;
          break;
        }
      }
    }
    return { searchId, attempted, succeeded, failed, blocked };
  }

  private async captureWithAttempt(listingId: number): Promise<ListingDetailCaptureResult> {
    const database = this.#database();
    const listing = database.listings.get(listingId);
    if (listing === undefined) throw new Error(`Listing not found: ${listingId}`);
    const previous = database.listingDetailCaptureAttempts.get(listingId);
    if (listing.source === "standvirtual" && previous && (previous.state === "processing" || previous.nextAttemptAt > this.#now().toISOString())) {
      throw new StandvirtualDetailError("DETAIL_CAPTURE_COOLDOWN", `Detail capture is available after ${previous.nextAttemptAt}.`);
    }
    const attemptedAt = this.#now().toISOString();
    database.listingDetailCaptureAttempts.begin(listingId, attemptedAt);
    try {
      const result = await this.captureListing(listingId);
      return result;
    } catch (error: unknown) {
      const completedAt = this.#now().toISOString();
      database.listingDetailCaptureAttempts.completeFailure(
        listingId,
        completedAt,
        offsetTimestamp(completedAt, DETAIL_CAPTURE_FAILURE_COOLDOWN_MS),
        detailCaptureErrorCode(error)
      );
      throw error;
    }
  }

  private async withCaptureLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#captureTail;
    let release!: () => void;
    this.#captureTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!this.#recovered) {
        const now = this.#now().toISOString();
        this.#database().listingDetailCaptureAttempts.recoverInterrupted(now, offsetTimestamp(now, DETAIL_CAPTURE_FAILURE_COOLDOWN_MS));
        this.#recovered = true;
      }
      return await operation();
    } finally {
      release();
    }
  }

  private async captureListing(listingId: number): Promise<ListingDetailCaptureResult> {
    const database = this.#database();
    const listing = database.listings.get(listingId);
    if (listing === undefined) throw new Error(`Listing not found: ${listingId}`);
    if (listing.source === "standvirtual") canonicalStandvirtualDetailUrl(listing.listingUrl);
    if (listing.source === "facebook" && !isSafeFacebookListingUrl(listing.listingUrl)) {
      throw new Error("Listing URL is not a safe Facebook Marketplace URL");
    }
    if (database.listingClassifications.get(listingId)?.decision === "exclude") {
      throw new Error("Excluded listings cannot be detail-enriched");
    }
    const stored = database.normalizedVehicles.getFacts(listingId);
    if (stored === undefined) throw new Error("Normalized listing facts are required before detail capture");

    await this.#browser().navigateListing(listing.listingUrl);
    const snapshot = await this.#browser().snapshotListingDetail();
    if (listing.source === "facebook" && !sameFacebookListingUrl(listing.listingUrl, snapshot.url)) {
      throw new Error("Facebook listing detail navigation did not remain on the selected listing");
    }
    if (listing.source === "standvirtual" && snapshot.loading) throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_NOT_READY", "The detail page is still loading; try again later.");
    const standvirtual = listing.source === "standvirtual"
      ? parseStandvirtualDetail(snapshot.html, listing.listingUrl, snapshot.url, this.#now().getUTCFullYear()) : null;
    const detail = standvirtual ?? parseFacebookListingDetail(snapshot.html);
    const capturedAt = this.#now().toISOString();
    const result = database.transaction(() => {
      const normalizeInput = {
        ...stored.facts.original,
        description: detail.description ?? (standvirtual ? database.rawCandidates.listObservations(listing.rawCandidateId).at(-1)?.description ?? null : stored.facts.original.description),
        referenceYear: new Date(capturedAt).getUTCFullYear(),
        structuredSource: listing.source,
        seller: stored.facts.seller
      };
      const descriptionNormalized = normalizeVehicleFacts({ ...normalizeInput, cardFacts: [] });
      const cardNormalized = normalizeVehicleFacts({ ...normalizeInput, description: null });
      const normalized = applyReusableRules(normalizeVehicleFacts({
        ...normalizeInput,
        ...(detail.structuredFacts === undefined ? {} : { structuredFacts: detail.structuredFacts })
      }), database.corrections.listApprovedRules());
      if (detail.description !== null) {
        database.listingDetailDescriptions.save(listingId, detail.description, capturedAt);
      } else if (standvirtual) database.listingDetailDescriptions.delete(listingId);
      database.listingDetailFacts.save(
        listingId,
        structuredFactValues(detail.structuredFacts),
        { ...normalizedFactValues(descriptionNormalized, cardNormalized.mileageKm),
          ...(standvirtual ? { cardFacts: normalizedFactValues(cardNormalized) } : {}) },
        normalizedFactValues(normalized),
        capturedAt, listing.source, standvirtual?.evidence ?? null
      );
      database.normalizedVehicles.saveFacts(
        listingId,
        stored.rawObservationId,
        normalized,
        capturedAt,
        stored.parserVersion
      );
      const effective = applyFactCorrections(
        normalized,
        database.corrections.listForListing(listingId)
      );
      database.normalizedVehicles.saveRisk(listingId, assessVehicleRisk(effective), capturedAt);
      let plausible = false;
      for (const searchId of database.listings.listSearchIds(listingId)) {
        const search = database.searches.get(searchId);
        if (search === undefined) continue;
        const match = evaluateVehicleMatch(effective, search.criteria);
        database.normalizedVehicles.saveMatch(listingId, searchId, match, capturedAt);
        plausible ||= match.status !== "excluded";
        database.dealScores.delete(listingId, searchId);
      }
      if (plausible) database.enrichmentProcessing.enqueue(listingId, capturedAt);
      if (standvirtual) new DealScoringService({ database: this.#database }).recomputeAll(capturedAt);
      database.listingDetailCaptureAttempts.completeSuccess(listingId, capturedAt,
        offsetTimestamp(capturedAt, DETAIL_CAPTURE_SUCCESS_COOLDOWN_MS));
      return { plausible };
    });
    if (result.plausible) this.#processingWake?.();
    return {
      listingId,
      description: detail.description,
      capturedAt,
      queuedForEnrichment: result.plausible
    };
  }
}

function structuredFactValues(
  facts: (StructuredVehicleFacts & { condition?: string | null; listingCondition?: string | null }) | undefined
): ListingDetailStructuredFacts {
  return {
    ...(facts?.sellerType === undefined ? {} : { sellerType: facts.sellerType }),
    ...(facts?.imported === undefined ? {} : { imported: facts.imported }),
    year: facts?.year ?? null,
    mileageKm: facts?.mileageKm ?? null,
    make: facts?.make ?? null,
    model: facts?.model ?? null,
    variant: facts?.variant ?? null,
    fuel: facts?.fuel ?? null,
    transmission: facts?.transmission ?? null,
    powerHp: facts?.powerHp ?? null,
    condition: facts?.condition ?? null,
    listingCondition: facts?.listingCondition ?? null
  };
}

function normalizedFactValues(
  facts: ReturnType<typeof normalizeVehicleFacts>,
  cardMileageKm?: number | null
): ListingDetailFactValues {
  return {
    year: facts.year,
    mileageKm: facts.mileageKm,
    make: facts.make,
    model: facts.model,
    variant: facts.variant,
    fuel: facts.fuel,
    transmission: facts.transmission,
    powerHp: facts.powerHp,
    ...(cardMileageKm === undefined ? {} : { cardMileageKm })
  };
}

function isSafeFacebookListingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com")) &&
      /^\/marketplace\/(?:shops\/|np\/)?item\/\d+\/?$/u.test(url.pathname);
  } catch {
    return false;
  }
}

function sameFacebookListingUrl(expected: string, actual: string): boolean {
  try {
    const expectedUrl = new URL(expected);
    const actualUrl = new URL(actual);
    return isSafeFacebookListingUrl(actual) &&
      expectedUrl.pathname === actualUrl.pathname;
  } catch {
    return false;
  }
}

function offsetTimestamp(value: string, offsetMs: number): string {
  return new Date(Date.parse(value) + offsetMs).toISOString();
}

function detailCaptureErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null &&
      "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.name : "DETAIL_CAPTURE_FAILED";
}

function isBrowserUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null ||
      !("code" in error) || typeof error.code !== "string") return false;
  return [
    "BROWSER_NOT_OPEN",
    "BROWSER_BUSY",
    "BROWSER_DETAIL_UNSUPPORTED",
    "BROWSER_RESUME_REQUIRED",
    "STANDVIRTUAL_DETAIL_BLOCKED"
  ].includes(error.code);
}
