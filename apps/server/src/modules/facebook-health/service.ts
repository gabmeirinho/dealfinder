import type { DatabaseConnection } from "@dealfinder/db";
import type {
  AcquisitionPause,
  FacebookAcquisitionHealth
} from "@dealfinder/domain";

import type { BrowserManager } from "../browser/index.js";
import type { ScanScheduler } from "../scheduler/index.js";

export interface FacebookHealthServiceOptions {
  database: () => DatabaseConnection;
  browser: () => BrowserManager;
  scheduler: () => ScanScheduler;
  now?: () => Date;
}

export class FacebookHealthService {
  readonly #database: () => DatabaseConnection;
  readonly #browser: () => BrowserManager;
  readonly #scheduler: () => ScanScheduler;
  readonly #now: () => Date;

  public constructor(options: FacebookHealthServiceOptions) {
    this.#database = options.database;
    this.#browser = options.browser;
    this.#scheduler = options.scheduler;
    this.#now = options.now ?? (() => new Date());
  }

  public status(): FacebookAcquisitionHealth {
    const pauses = this.#database().facebookHealth.listActivePauses();
    return {
      status: pauses.length === 0 ? "ok" : "paused",
      pauses,
      diagnosticsRetentionDays: 7,
      automaticSelectorRepair: false,
      screenshotsExternal: false
    };
  }

  public async resume(pauseId: string): Promise<AcquisitionPause> {
    const repository = this.#database().facebookHealth;
    const pause = repository.getPause(pauseId);
    if (pause === undefined || pause.resolvedAt !== null) {
      throw new FacebookHealthCommandError(404, "PAUSE_NOT_FOUND", "Active acquisition pause not found");
    }
    if (pause.scope === "browser") {
      const browser = this.#browser();
      const status = browser.getStatus();
      if (status.state !== "open") {
        throw new FacebookHealthCommandError(
          409,
          "BROWSER_REVIEW_REQUIRED",
          "Resume the visible browser and resolve Facebook's prompt before resuming acquisition"
        );
      }
    }
    const resolved = repository.resolve(pauseId, this.#now().toISOString());
    if (resolved === undefined) {
      throw new FacebookHealthCommandError(409, "PAUSE_ALREADY_RESOLVED", "Acquisition was already resumed");
    }
    this.#scheduler().resumeAcquisition(pause.scope === "search" ? pause.searchId : null);
    return resolved;
  }
}

export class FacebookHealthCommandError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "FacebookHealthCommandError";
  }
}
