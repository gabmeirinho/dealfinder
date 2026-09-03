import type { DatabaseConnection } from "@dealfinder/db";
import type {
  ListingDetailFactValues,
  ListingDetailStructuredFacts
} from "@dealfinder/db";
import {
  applyFactCorrections,
  assessVehicleRisk,
  evaluateVehicleMatch,
  normalizeVehicleFacts
} from "@dealfinder/domain";

import type { BrowserManager } from "../../browser/index.js";
import {
  parseFacebookListingDetail,
  type FacebookListingStructuredFacts
} from "../../../sources/facebook/detail-parser/index.js";

export interface ListingDetailCaptureServiceOptions {
  database: () => DatabaseConnection;
  browser: () => BrowserManager;
  processingWake?: () => void;
  now?: () => Date;
}

export interface ListingDetailCaptureResult {
  listingId: number;
  description: string;
  capturedAt: string;
  queuedForEnrichment: boolean;
}

export class ListingDetailCaptureService {
  readonly #database: () => DatabaseConnection;
  readonly #browser: () => BrowserManager;
  readonly #processingWake: (() => void) | undefined;
  readonly #now: () => Date;

  public constructor(options: ListingDetailCaptureServiceOptions) {
    this.#database = options.database;
    this.#browser = options.browser;
    this.#processingWake = options.processingWake;
    this.#now = options.now ?? (() => new Date());
  }

  public async capture(listingId: number): Promise<ListingDetailCaptureResult> {
    const database = this.#database();
    const listing = database.listings.get(listingId);
    if (listing === undefined) throw new Error(`Listing not found: ${listingId}`);
    if (listing.source !== "facebook") throw new Error("Only Facebook listing details are supported");
    if (!isSafeFacebookListingUrl(listing.listingUrl)) {
      throw new Error("Listing URL is not a safe Facebook Marketplace URL");
    }
    if (database.listingClassifications.get(listingId)?.decision === "exclude") {
      throw new Error("Excluded listings cannot be detail-enriched");
    }
    const stored = database.normalizedVehicles.getFacts(listingId);
    if (stored === undefined) throw new Error("Normalized listing facts are required before detail capture");

    await this.#browser().navigateListing(listing.listingUrl);
    const snapshot = await this.#browser().snapshotListingDetail();
    if (!sameFacebookListingUrl(listing.listingUrl, snapshot.url)) {
      throw new Error("Facebook listing detail navigation did not remain on the selected listing");
    }
    const detail = parseFacebookListingDetail(snapshot.html);
    const capturedAt = this.#now().toISOString();
    const result = database.transaction(() => {
      const normalizeInput = {
        ...stored.facts.original,
        description: detail.description,
        referenceYear: new Date(capturedAt).getUTCFullYear(),
        seller: stored.facts.seller
      };
      const descriptionNormalized = normalizeVehicleFacts({ ...normalizeInput, cardFacts: [] });
      const cardNormalized = normalizeVehicleFacts({ ...normalizeInput, description: null });
      const normalized = normalizeVehicleFacts({
        ...normalizeInput,
        ...(detail.structuredFacts === undefined ? {} : { structuredFacts: detail.structuredFacts })
      });
      database.listingDetailDescriptions.save(listingId, detail.description, capturedAt);
      database.listingDetailFacts.save(
        listingId,
        structuredFactValues(detail.structuredFacts),
        normalizedFactValues(descriptionNormalized, cardNormalized.mileageKm),
        normalizedFactValues(normalized),
        capturedAt
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
      let eligible = false;
      for (const searchId of database.listings.listSearchIds(listingId)) {
        const search = database.searches.get(searchId);
        if (search === undefined) continue;
        const match = evaluateVehicleMatch(effective, search.criteria);
        database.normalizedVehicles.saveMatch(listingId, searchId, match, capturedAt);
        eligible ||= match.eligible;
        database.dealScores.delete(listingId, searchId);
      }
      if (eligible) database.enrichmentProcessing.enqueue(listingId, capturedAt);
      return { eligible };
    });
    if (result.eligible) this.#processingWake?.();
    return {
      listingId,
      description: detail.description,
      capturedAt,
      queuedForEnrichment: result.eligible
    };
  }
}

function structuredFactValues(
  facts: FacebookListingStructuredFacts | undefined
): ListingDetailStructuredFacts {
  return {
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
