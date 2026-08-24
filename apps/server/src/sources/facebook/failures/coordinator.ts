import type { DatabaseConnection } from "@dealfinder/db";
import type {
  AcquisitionPause,
  BrowserAttentionReason,
  FacebookFailureKind
} from "@dealfinder/domain";

import type { MarketplaceResultSnapshot } from "../../../modules/browser/index.js";
import type { DiagnosticsService } from "../../../modules/diagnostics/index.js";
import type { FacebookPageFailure } from "./classifier.js";

export interface FailureBrowser {
  captureDiagnosticScreenshot(): Promise<Uint8Array | null>;
  pauseForAttention(
    reason: Exclude<BrowserAttentionReason, "browser_closed" | "launch_failed">,
    detail?: string | null
  ): Promise<unknown>;
}

export interface FacebookFailureNotice {
  kind: FacebookFailureKind;
  scope: FacebookPageFailure["scope"];
  searchId: string;
  detail: string;
}

export interface FacebookFailureNotifier {
  notify(notice: FacebookFailureNotice): void | Promise<void>;
}

export interface FacebookFailureCoordinatorOptions {
  database: () => DatabaseConnection;
  diagnostics: DiagnosticsService;
  browser: () => FailureBrowser;
  notifier?: FacebookFailureNotifier;
  now?: () => Date;
}

export class FacebookFailureCoordinator {
  readonly #database: () => DatabaseConnection;
  readonly #diagnostics: DiagnosticsService;
  readonly #browser: () => FailureBrowser;
  readonly #notifier: FacebookFailureNotifier | undefined;
  readonly #now: () => Date;

  public constructor(options: FacebookFailureCoordinatorOptions) {
    this.#database = options.database;
    this.#diagnostics = options.diagnostics;
    this.#browser = options.browser;
    this.#notifier = options.notifier;
    this.#now = options.now ?? (() => new Date());
  }

  public async pause(
    searchId: string,
    failure: FacebookPageFailure,
    snapshot: MarketplaceResultSnapshot
  ): Promise<AcquisitionPause> {
    const browser = this.#browser();
    const screenshot = await browser.captureDiagnosticScreenshot().catch(() => null);
    const page = snapshot.page;
    const diagnostic = await this.#diagnostics.capture({
      failureKind: failure.kind,
      detail: failure.detail,
      searchId,
      pageUrl: page?.url ?? "https://www.facebook.com/marketplace/",
      rawHtml: page?.html ?? snapshot.cards.join(""),
      screenshot
    }).catch(() => null);
    const pause = this.#database().facebookHealth.pause({
      scope: failure.scope,
      scopeKey: scopeKey(failure.scope, searchId),
      searchId: failure.scope === "search" ? searchId : null,
      failureKind: failure.kind,
      detail: failure.detail,
      diagnosticId: diagnostic?.id ?? null,
      pausedAt: this.#now().toISOString()
    });

    if (failure.scope === "browser") {
      await browser.pauseForAttention(browserReason(failure.kind), failure.detail);
    }
    await Promise.resolve(this.#notifier?.notify({
      kind: failure.kind,
      scope: failure.scope,
      searchId,
      detail: failure.detail
    })).catch(() => undefined);
    return pause;
  }
}

export class FacebookAcquisitionPausedError extends Error {
  public readonly code: string;

  public constructor(
    public readonly failure: FacebookPageFailure,
    public readonly pauseId: string
  ) {
    super(failure.detail);
    this.name = "FacebookAcquisitionPausedError";
    this.code = `FACEBOOK_${failure.kind.toLocaleUpperCase("en")}`;
  }
}

function scopeKey(scope: FacebookPageFailure["scope"], searchId: string): string {
  if (scope === "browser") return "facebook-browser";
  if (scope === "source") return "facebook";
  return searchId;
}

function browserReason(
  kind: FacebookFailureKind
): Exclude<BrowserAttentionReason, "browser_closed" | "launch_failed"> {
  if (kind === "login_required") return "login_required";
  if (kind === "marketplace_restricted") return "marketplace_denied";
  if (kind === "consent_required") return "consent_required";
  return "checkpoint";
}
