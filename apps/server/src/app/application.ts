import type { Server } from "node:http";

import { openDatabase, type DatabaseConnection } from "@dealfinder/db";
import type { ServerConfig } from "@dealfinder/domain";

import {
  closeHttpServer,
  createHttpServer,
  listenHttpServer,
  type BoundAddress
} from "./http.js";
import { LifecycleRuntime } from "./lifecycle.js";
import {
  BrowserManager,
  PlaywrightBrowserAdapter,
  type BrowserAdapter
} from "../modules/browser/index.js";
import { ListingIngestionService } from "../modules/listings/index.js";
import { SearchVerificationService } from "../modules/search-verification/index.js";
import { ScanScheduler } from "../modules/scheduler/index.js";
import { DiagnosticsService } from "../modules/diagnostics/index.js";
import { FacebookFailureCoordinator } from "../sources/facebook/failures/index.js";
import { FacebookHealthService } from "../modules/facebook-health/index.js";
import { FacebookScanner } from "../sources/facebook/scanner/index.js";
import { createLogger, type Logger } from "../logging/index.js";
import {
  DeepSeekClient,
  DeepSeekEnrichmentService,
  DeepSeekEnrichmentWorker
} from "../integrations/deepseek/index.js";
import { DealScoringService } from "../modules/scoring/index.js";
import {
  DuplicateDetectionService,
  DuplicateMaintenanceWorker,
  ThumbnailStorage
} from "../modules/duplicates/index.js";
import { ListingReviewService } from "../modules/workflow/index.js";
import { ListingDetailCaptureService } from "../modules/listings/detail-enrichment/index.js";

export interface ApplicationOptions {
  config: ServerConfig;
  staticDirectory?: string;
  browserAdapter?: BrowserAdapter;
  logger?: Logger;
}

export interface ApplicationRuntime {
  readonly database: DatabaseConnection | undefined;
  readonly browser: BrowserManager;
  readonly scheduler: ScanScheduler;
  readonly enrichment: DeepSeekEnrichmentWorker;
  readonly scoring: DealScoringService;
  readonly duplicates: DuplicateMaintenanceWorker;
  readonly server: Server;
  readonly address: BoundAddress | undefined;
  start(): Promise<BoundAddress>;
  stop(): Promise<void>;
}

export function createApplicationRuntime(
  options: ApplicationOptions
): ApplicationRuntime {
  let database: DatabaseConnection | undefined;
  let address: BoundAddress | undefined;
  const getDatabase = (): DatabaseConnection => {
    if (database === undefined) throw new Error("Database is not running");
    return database;
  };
  const logger = options.logger ?? createLogger({
    config: options.config,
    level: options.config.diagnostics.level
  });
  const browser = new BrowserManager({
    adapter: options.browserAdapter ?? new PlaywrightBrowserAdapter(),
    profileDirectory: options.config.paths.chromiumProfileDir
  });
  const searchVerification = new SearchVerificationService({
    database: getDatabase,
    browser: () => browser
  });
  const diagnostics = new DiagnosticsService({
    directory: options.config.paths.diagnosticsDir,
    database: getDatabase,
    enabled: options.config.diagnostics.enabled
  });
  const facebookFailures = new FacebookFailureCoordinator({
    database: getDatabase,
    diagnostics,
    browser: () => browser
  });
  const deepseekClient = options.config.deepseek.enabled && options.config.deepseek.apiKey !== undefined
    ? new DeepSeekClient({
      apiKey: options.config.deepseek.apiKey,
      baseUrl: options.config.deepseek.baseUrl
    })
    : undefined;
  const scoring = new DealScoringService({ database: getDatabase });
  const thumbnailStorage = new ThumbnailStorage({
    directory: options.config.paths.thumbnailsDir,
    database: getDatabase
  });
  const duplicateDetection = new DuplicateDetectionService({
    database: getDatabase,
    thumbnails: thumbnailStorage,
    logger
  });
  const duplicates = new DuplicateMaintenanceWorker({
    service: duplicateDetection,
    onError: (error) => logger.error("Duplicate maintenance failed", {
      errorType: error instanceof Error ? error.name : "unknown"
    })
  });
  const enrichmentService = new DeepSeekEnrichmentService({
    database: getDatabase,
    ...(deepseekClient === undefined ? {} : { client: deepseekClient }),
    enabled: options.config.deepseek.enabled,
    logger,
    afterEnrichment: (_listingId, completedAt) => {
      scoring.recomputeAll(completedAt);
      duplicates.wake();
    }
  });
  const enrichment = new DeepSeekEnrichmentWorker({
    database: getDatabase,
    service: enrichmentService
  });
  const listingDetailCapture = new ListingDetailCaptureService({
    database: getDatabase,
    browser: () => browser,
    processingWake: () => enrichment.wake()
  });
  const scanner = new FacebookScanner({
    database: getDatabase,
    browser: () => browser,
    failures: facebookFailures,
    afterScan: async (searchId) => {
      try {
        const result = await listingDetailCapture.captureEligible(searchId);
        if (result.attempted > 0) {
          logger.info("Facebook detail capture batch completed", {
            searchId,
            attempted: result.attempted,
            succeeded: result.succeeded,
            failed: result.failed,
            blocked: result.blocked
          });
        }
      } catch (error: unknown) {
        logger.warn("Facebook detail capture batch unavailable", {
          searchId,
          errorType: error instanceof Error ? error.name : "unknown"
        });
      }
    },
    processingWake: () => {
      enrichment.wake();
      duplicates.wake();
    },
    onStageError: ({ phase, error }) => logger.error("Facebook scan stage failed", {
      phase,
      errorType: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : "Unknown scanner failure"
    })
  });
  const scheduler = new ScanScheduler({
    database: getDatabase,
    scanner
  });
  const facebookHealth = new FacebookHealthService({
    database: getDatabase,
    browser: () => browser,
    scheduler: () => scheduler
  });
  browser.onOpened(() => scheduler.wake());
  const listingWorkflow = new ListingReviewService(getDatabase, () => enrichment.wake());
  const server = createHttpServer({
    database: getDatabase,
    browser: () => browser,
    searchVerification: () => searchVerification,
    scanScheduler: () => scheduler,
    facebookHealth: () => facebookHealth,
    deepseek: () => enrichment,
    listingWorkflow: () => listingWorkflow,
    listingDetailCapture: () => listingDetailCapture,
    ...(options.staticDirectory === undefined
      ? {}
      : { staticDirectory: options.staticDirectory })
  });
  const lifecycle = new LifecycleRuntime([
    {
      name: "database",
      start: () => {
        database = openDatabase({ filename: options.config.paths.sqlitePath });
        const backfilled = new ListingIngestionService(getDatabase)
          .backfillClassifications(new Date().toISOString());
        if (backfilled > 0) {
          logger.info("Listing classifications backfilled", { count: backfilled });
        }
      },
      stop: () => {
        database?.close();
        database = undefined;
      }
    },
    {
      name: "diagnostics",
      start: () => diagnostics.cleanupExpired(),
      stop: () => undefined
    },
    {
      name: "browser",
      start: () => undefined,
      stop: () => browser.shutdown()
    },
    {
      name: "deal-scoring",
      start: () => {
        scoring.recomputeAll(new Date().toISOString());
      },
      stop: () => undefined
    },
    {
      name: "deepseek-enrichment",
      start: () => {
        if (options.config.deepseek.enabled) enrichment.start();
      },
      stop: () => enrichment.stop()
    },
    {
      name: "duplicate-maintenance",
      start: () => duplicates.start(),
      stop: () => duplicates.stop()
    },
    {
      name: "scheduler",
      start: () => scheduler.start(),
      stop: () => scheduler.stop()
    },
    {
      name: "http",
      start: async () => {
        address = await listenHttpServer(server, options.config.server);
      },
      stop: async () => {
        await closeHttpServer(server);
        address = undefined;
      }
    }
  ]);

  return {
    get database() {
      return database;
    },
    browser,
    scheduler,
    enrichment,
    scoring,
    duplicates,
    server,
    get address() {
      return address;
    },
    start: async () => {
      await lifecycle.start();
      if (address === undefined) throw new Error("HTTP server did not start");
      return address;
    },
    stop: () => lifecycle.stop()
  };
}
