import type {
  BrowserAttentionReason,
  BrowserStatus
} from "@dealfinder/domain";

import type { BrowserAdapter, BrowserSession } from "./adapter.js";
import type { MarketplaceResultSnapshot } from "./adapter.js";

export class BrowserCommandError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "BrowserCommandError";
  }
}

export interface BrowserManagerOptions {
  adapter: BrowserAdapter;
  profileDirectory: string;
  now?: () => Date;
}

export class BrowserManager {
  readonly #adapter: BrowserAdapter;
  readonly #profileDirectory: string;
  readonly #now: () => Date;
  #session: BrowserSession | undefined;
  #removeClosedListener: (() => void) | undefined;
  #status: BrowserStatus;
  readonly #openedListeners = new Set<() => void>();

  public constructor(options: BrowserManagerOptions) {
    this.#adapter = options.adapter;
    this.#profileDirectory = options.profileDirectory;
    this.#now = options.now ?? (() => new Date());
    this.#status = this.createStatus("stopped");
  }

  public getStatus(): BrowserStatus {
    return { ...this.#status };
  }

  public onOpened(listener: () => void): () => void {
    this.#openedListeners.add(listener);
    return () => this.#openedListeners.delete(listener);
  }

  public async open(): Promise<BrowserStatus> {
    if (this.#status.state === "paused") {
      throw new BrowserCommandError(
        "BROWSER_RESUME_REQUIRED",
        "The browser is paused for attention; use resume after resolving it"
      );
    }
    if (this.#status.state !== "stopped") {
      throw new BrowserCommandError(
        "BROWSER_ALREADY_ACTIVE",
        "The browser is already open or changing state"
      );
    }
    return await this.launch();
  }

  public async resume(): Promise<BrowserStatus> {
    if (this.#status.state !== "paused") {
      throw new BrowserCommandError(
        "BROWSER_NOT_PAUSED",
        "The browser can only resume from a paused attention state"
      );
    }
    return await this.launch();
  }

  public async stop(): Promise<BrowserStatus> {
    if (this.#status.state === "stopped") return this.getStatus();
    if (this.#status.state !== "open" || this.#session === undefined) {
      throw new BrowserCommandError(
        "BROWSER_BUSY",
        "Wait for the current browser operation to finish"
      );
    }

    this.#status = this.createStatus("stopping");
    const session = this.detachSession();
    try {
      await session?.close();
    } finally {
      this.#status = this.createStatus("stopped");
    }
    return this.getStatus();
  }

  public async navigate(url: string): Promise<string> {
    return await this.requireOpenSession().navigate(url);
  }

  public currentUrl(): string {
    return this.requireOpenSession().currentUrl();
  }

  public async snapshotMarketplaceResults(): Promise<MarketplaceResultSnapshot> {
    const session = this.requireOpenSession();
    const snapshot = session.snapshotMarketplaceResults;
    if (snapshot === undefined) {
      throw new BrowserCommandError(
        "BROWSER_SCAN_UNSUPPORTED",
        "The active browser adapter cannot inspect Marketplace results"
      );
    }
    return await snapshot.call(session);
  }

  public async scrollMarketplaceResults(): Promise<void> {
    const session = this.requireOpenSession();
    const scroll = session.scrollMarketplaceResults;
    if (scroll === undefined) {
      throw new BrowserCommandError(
        "BROWSER_SCAN_UNSUPPORTED",
        "The active browser adapter cannot scroll Marketplace results"
      );
    }
    await scroll.call(session);
  }

  public async captureDiagnosticScreenshot(): Promise<Uint8Array | null> {
    const session = this.requireOpenSession();
    const capture = session.captureDiagnosticScreenshot;
    return capture === undefined ? null : await capture.call(session);
  }

  public async pauseForAttention(
    reason: Exclude<BrowserAttentionReason, "browser_closed" | "launch_failed">,
    detail: string | null = null
  ): Promise<BrowserStatus> {
    const session = this.detachSession();
    try {
      if (session !== undefined) await session.close();
    } finally {
      this.#status = this.createStatus("paused", reason, detail);
    }
    return this.getStatus();
  }

  public async shutdown(): Promise<void> {
    const session = this.detachSession();
    try {
      if (session !== undefined) await session.close();
    } finally {
      this.#status = this.createStatus("stopped");
    }
  }

  private async launch(): Promise<BrowserStatus> {
    this.#status = this.createStatus("opening");
    try {
      const session = await this.#adapter.open(this.#profileDirectory);
      this.#session = session;
      this.#removeClosedListener = session.onClosed(() => this.handleUnexpectedClosure());
      this.#status = this.createStatus("open", null, null, session.controlledTabs);
      for (const listener of this.#openedListeners) listener();
      return this.getStatus();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Chromium could not be opened";
      this.#status = this.createStatus("paused", "launch_failed", detail);
      throw new BrowserCommandError("BROWSER_LAUNCH_FAILED", detail);
    }
  }

  private handleUnexpectedClosure(): void {
    if (this.#status.state !== "open") return;
    this.detachSession();
    this.#status = this.createStatus(
      "paused",
      "browser_closed",
      "The controlled browser window was closed"
    );
  }

  private detachSession(): BrowserSession | undefined {
    this.#removeClosedListener?.();
    this.#removeClosedListener = undefined;
    const session = this.#session;
    this.#session = undefined;
    return session;
  }

  private requireOpenSession(): BrowserSession {
    if (this.#status.state !== "open" || this.#session === undefined) {
      throw new BrowserCommandError(
        "BROWSER_NOT_OPEN",
        "Open the visible browser before verifying a Facebook search"
      );
    }
    return this.#session;
  }

  private createStatus(
    state: BrowserStatus["state"],
    attentionReason: BrowserAttentionReason | null = null,
    attentionDetail: string | null = null,
    controlledTabs: 0 | 1 = 0
  ): BrowserStatus {
    return {
      state,
      attentionReason,
      attentionDetail,
      changedAt: this.#now().toISOString(),
      profilePersistent: true,
      controlledTabs
    };
  }
}
