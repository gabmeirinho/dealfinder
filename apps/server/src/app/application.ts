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
import { SearchVerificationService } from "../modules/search-verification/index.js";
import { ScanScheduler } from "../modules/scheduler/index.js";
import { DiagnosticsService } from "../modules/diagnostics/index.js";
import { FacebookFailureCoordinator } from "../sources/facebook/failures/index.js";
import { FacebookHealthService } from "../modules/facebook-health/index.js";
import { FacebookScanner } from "../sources/facebook/scanner/index.js";

export interface ApplicationOptions {
  config: ServerConfig;
  staticDirectory?: string;
  browserAdapter?: BrowserAdapter;
}

export interface ApplicationRuntime {
  readonly database: DatabaseConnection | undefined;
  readonly browser: BrowserManager;
  readonly scheduler: ScanScheduler;
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
  const scanner = new FacebookScanner({
    database: getDatabase,
    browser: () => browser,
    failures: facebookFailures
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
  const server = createHttpServer({
    database: getDatabase,
    browser: () => browser,
    searchVerification: () => searchVerification,
    scanScheduler: () => scheduler,
    facebookHealth: () => facebookHealth,
    ...(options.staticDirectory === undefined
      ? {}
      : { staticDirectory: options.staticDirectory })
  });
  const lifecycle = new LifecycleRuntime([
    {
      name: "database",
      start: () => {
        database = openDatabase({ filename: options.config.paths.sqlitePath });
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
