import type { DatabaseConnection } from "@dealfinder/db";
import { validateVehicleSearch, type StandvirtualScanReport } from "@dealfinder/domain";

import { ListingIngestionService } from "../../modules/listings/index.js";
import type { DealScoringService } from "../../modules/scoring/index.js";
import type { DuplicateDetectionService } from "../../modules/duplicates/index.js";
import { collectStandvirtualResults } from "./collector.js";
import { buildStandvirtualSearch } from "./search-builder.js";

export type { StandvirtualScanReport } from "@dealfinder/domain";

export interface StandvirtualScannerOptions {
  database: () => DatabaseConnection;
  scoring: DealScoringService;
  duplicates: DuplicateDetectionService;
  processingWake?: () => void;
  now?: () => Date;
  collect?: typeof collectStandvirtualResults;
}

/** Collects broad budget results or targeted market evidence through shared ingestion. */
export class StandvirtualScanner {
  readonly #database: () => DatabaseConnection;
  readonly #scoring: DealScoringService;
  readonly #duplicates: DuplicateDetectionService;
  readonly #processingWake: () => void;
  readonly #now: () => Date;
  readonly #collect: typeof collectStandvirtualResults;

  public constructor(options: StandvirtualScannerOptions) {
    this.#database = options.database;
    this.#scoring = options.scoring;
    this.#duplicates = options.duplicates;
    this.#processingWake = options.processingWake ?? (() => undefined);
    this.#now = options.now ?? (() => new Date());
    this.#collect = options.collect ?? collectStandvirtualResults;
  }

  public async scan(searchId: string): Promise<StandvirtualScanReport> {
    const database = this.#database();
    const previous = database.searches.get(searchId)?.standvirtualScan;
    const lastAttemptAt = this.#now().toISOString();
    try {
      const report = await this.executeScan(searchId);
      database.searches.saveStandvirtualScan(searchId, {
        lastAttemptAt,
        lastSuccessAt: report.partialError === null ? report.observedAt : previous?.lastSuccessAt ?? null,
        lastError: report.partialError,
        report
      });
      return report;
    } catch (error) {
      database.searches.saveStandvirtualScan(searchId, {
        lastAttemptAt, lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastError: error instanceof Error ? error.message : "Scan failed", report: null
      });
      throw error;
    }
  }

  private async executeScan(searchId: string): Promise<StandvirtualScanReport> {
    const database = this.#database();
    const search = database.searches.get(searchId);
    if (search === undefined) throw new StandvirtualScanError(404, "SEARCH_NOT_FOUND", "Saved search not found");
    if (!search.active) throw new StandvirtualScanError(409, "SEARCH_INACTIVE", "Activate the search before scanning Standvirtual");
    const validation = validateVehicleSearch(search);
    if (!validation.success) throw new StandvirtualScanError(400, "INVALID_SEARCH", validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    const searchScope = search.criteria.searchScope ?? "targeted";
    const target = search.criteria.modelTarget?.value;
    if (searchScope === "targeted" && target === undefined) {
      throw new StandvirtualScanError(409, "MODEL_TARGET_REQUIRED", "Standvirtual scans require an explicit make and model target");
    }
    const petrolOnly = search.criteria.fuels?.strength === "hard" &&
      search.criteria.fuels.value.length === 1 && search.criteria.fuels.value[0] === "petrol";
    const pricePolicy = searchScope === "broad" ? "strict" : "market_evidence";
    const maximumPriceEur = search.criteria.priceRange?.strength === "hard"
      ? search.criteria.priceRange.value.maximumEur : null;
    let built;
    try {
      built = buildStandvirtualSearch({
        ...(target === undefined ? {} : { make: target.make, model: target.model }),
        ...(petrolOnly ? { fuel: "petrol" as const } : {}),
        ...(maximumPriceEur == null || pricePolicy === "market_evidence" ? {} : { maximumPriceEur }),
        pricePolicy
      });
    } catch (error) {
      throw new StandvirtualScanError(400, "INVALID_STANDVIRTUAL_QUERY", error instanceof Error ? error.message : "Invalid query");
    }
    const collected = await this.#collect(built.url, { limit: 800 });
    const observedAt = this.#now().toISOString();
    const initialScan = !database.rawCandidates.hasSourceObservations(searchId, "standvirtual");
    const ingestion = new ListingIngestionService(this.#database).ingestScan({
      searchId,
      observedAt,
      initialScan,
      // A Standvirtual scan must never mark Facebook listings missing for the same search.
      completeSnapshot: false,
      candidates: collected.listings.map((listing) => ({
        source: "standvirtual",
        sourceListingId: listing.sourceListingId,
        url: listing.canonicalUrl,
        title: listing.facts.original.title,
        description: listing.facts.original.description,
        displayedPrice: listing.facts.original.displayedPrice,
        location: null,
        thumbnailUrl: null,
        rawCardFacts: listing.facts.original.cardFacts
      }))
    });
    await this.#duplicates.recomputeAll(observedAt);
    const scores = this.#scoring.recomputeAll(observedAt);
    this.#processingWake();
    const eligible = ingestion.listings.filter((listing) =>
      database.normalizedVehicles.getMatch(listing.id, searchId)?.eligible === true
    ).length;
    return {
      searchScope,
      pricePolicy,
      searchId,
      observedAt,
      collected: collected.listings.length,
      eligible,
      pagesScanned: collected.pagesScanned,
      stopReason: collected.stopReason,
      partialError: collected.partialError,
      observationsInserted: ingestion.observationsInserted,
      listingsCreated: ingestion.listingsCreated,
      priceChanges: ingestion.priceChanges,
      scoresCalculated: scores.filter((score) => score.searchId === searchId).length
    };
  }
}

export class StandvirtualScanError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "StandvirtualScanError";
  }
}
