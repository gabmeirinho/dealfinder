import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runMigrations, type MigrationResult } from "./migration-runner.js";
import { allMigrations } from "./migrations/index.js";
import type { Migration } from "./migrations/types.js";
import { SettingsRepository } from "./repositories/settings-repository.js";
import { SearchesRepository } from "./repositories/searches.js";
import { SearchSourcesRepository } from "./repositories/search-sources.js";
import { RawCandidatesRepository } from "./repositories/raw-candidates.js";
import { ScanRunsRepository } from "./repositories/scan-runs.js";
import { FacebookHealthRepository } from "./repositories/facebook-health.js";
import { ListingsRepository } from "./repositories/listings.js";
import { NormalizedVehiclesRepository } from "./repositories/normalized-vehicles.js";
import { CorrectionsRepository } from "./repositories/corrections.js";
import { GeocodingRepository } from "./repositories/geocoding.js";
import { EnrichmentProcessingRepository } from "./repositories/enrichment-processing.js";
import { DealScoresRepository } from "./repositories/deal-scores.js";
import { withTransaction } from "./transactions.js";

export interface OpenDatabaseOptions {
  filename: string;
  migrations?: readonly Migration[];
  now?: () => Date;
}

export interface DatabaseConnection {
  readonly database: DatabaseSync;
  readonly filename: string;
  readonly migrationResult: MigrationResult;
  readonly settings: SettingsRepository;
  readonly searches: SearchesRepository;
  readonly searchSources: SearchSourcesRepository;
  readonly rawCandidates: RawCandidatesRepository;
  readonly scanRuns: ScanRunsRepository;
  readonly facebookHealth: FacebookHealthRepository;
  readonly listings: ListingsRepository;
  readonly normalizedVehicles: NormalizedVehiclesRepository;
  readonly corrections: CorrectionsRepository;
  readonly geocoding: GeocodingRepository;
  readonly enrichmentProcessing: EnrichmentProcessingRepository;
  readonly dealScores: DealScoresRepository;
  transaction<T>(operation: () => T): T;
  close(): void;
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseConnection {
  const filename = normalizeFilename(options.filename);
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const database = new DatabaseSync(filename);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    if (filename !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = NORMAL");
    }

    const foreignKeys = database
      .prepare("PRAGMA foreign_keys")
      .get() as unknown as { foreign_keys: number };
    if (foreignKeys.foreign_keys !== 1) {
      throw new Error("SQLite foreign key enforcement could not be enabled");
    }

    const now = options.now ?? (() => new Date());
    const migrationResult = runMigrations(
      database,
      options.migrations ?? allMigrations,
      now
    );
    const settings = new SettingsRepository(database, now);
    const searches = new SearchesRepository(database, now);
    const searchSources = new SearchSourcesRepository(database, now);
    const rawCandidates = new RawCandidatesRepository(database);
    const scanRuns = new ScanRunsRepository(database);
    const facebookHealth = new FacebookHealthRepository(database);
    const listings = new ListingsRepository(database);
    const normalizedVehicles = new NormalizedVehiclesRepository(database);
    const corrections = new CorrectionsRepository(database);
    const geocoding = new GeocodingRepository(database);
    const enrichmentProcessing = new EnrichmentProcessingRepository(database);
    const dealScores = new DealScoresRepository(database);
    let closed = false;

    return {
      database,
      filename,
      migrationResult,
      settings,
      searches,
      searchSources,
      rawCandidates,
      scanRuns,
      facebookHealth,
      listings,
      normalizedVehicles,
      corrections,
      geocoding,
      enrichmentProcessing,
      dealScores,
      transaction: <T>(operation: () => T) => withTransaction(database, operation),
      close: () => {
        if (closed) return;
        database.close();
        closed = true;
      }
    };
  } catch (error: unknown) {
    database.close();
    throw error;
  }
}

function normalizeFilename(filename: string): string {
  if (filename.trim() === "") {
    throw new Error("A non-empty SQLite filename is required");
  }

  return filename === ":memory:" ? filename : resolve(filename);
}
