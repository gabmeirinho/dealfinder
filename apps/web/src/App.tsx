import { useCallback, useEffect, useState, type ReactElement } from "react";

import type {
  BrowserStatus,
  FacebookAcquisitionHealth,
  HealthResponse,
  ManagedVehicleSearch
} from "@dealfinder/domain";

import { BrowserStatusPanel } from "./features/browser/BrowserStatusPanel.js";
import { SearchDashboard } from "./features/searches/SearchDashboard.js";
import { FacebookHealthPanel } from "./features/health/FacebookHealthPanel.js";
import { ListingDashboard } from "./features/listings/ListingDashboard.js";
import { fetchHealth } from "./health.js";
import type { BrowserApiClient } from "./lib/api/browser.js";
import type { SearchApiClient } from "./lib/api/searches.js";
import type { FacebookHealthApiClient } from "./lib/api/facebook-health.js";
import type { ListingApiClient, ListingSummary } from "./lib/api/listings.js";

export const appName = "Dealfinder" as const;
const distanceDisclosure = "Distances are approximate straight-line measurements between locality centroids, not routes or travel times. Locality data uses bundled offline Portuguese centroids.";

export type HealthState =
  | { phase: "loading" }
  | { phase: "ready"; health: HealthResponse }
  | { phase: "unavailable"; message: string };

export interface AppProps {
  healthClient?: () => Promise<HealthResponse>;
  initialHealth?: HealthState;
  searchesClient?: SearchApiClient;
  initialSearches?: readonly ManagedVehicleSearch[];
  browserClient?: BrowserApiClient;
  initialBrowserStatus?: BrowserStatus;
  facebookHealthClient?: FacebookHealthApiClient;
  initialFacebookHealth?: FacebookAcquisitionHealth;
  listingsClient?: ListingApiClient;
  initialListings?: readonly ListingSummary[];
  initialView?: "searches" | "inbox";
}

export function App({
  healthClient = fetchHealth,
  initialHealth,
  searchesClient,
  initialSearches,
  browserClient,
  initialBrowserStatus,
  facebookHealthClient,
  initialFacebookHealth,
  listingsClient,
  initialListings,
  initialView
}: AppProps = {}): ReactElement {
  const [view, setView] = useState<"searches" | "inbox">(
    initialView ?? (typeof window !== "undefined" && window.location.hash === "#inbox" ? "inbox" : "searches")
  );
  const [healthState, setHealthState] = useState<HealthState>(
    initialHealth ?? { phase: "loading" }
  );
  const refreshHealth = useCallback(async () => {
    setHealthState({ phase: "loading" });
    try {
      setHealthState({ phase: "ready", health: await healthClient() });
    } catch (error: unknown) {
      setHealthState({
        phase: "unavailable",
        message: error instanceof Error ? error.message : "Health check failed"
      });
    }
  }, [healthClient]);

  useEffect(() => {
    if (initialHealth === undefined) void refreshHealth();
  }, [initialHealth, refreshHealth]);

  useEffect(() => {
    if (initialView !== undefined || typeof window === "undefined") return undefined;
    const updateView = (): void => setView(window.location.hash === "#inbox" ? "inbox" : "searches");
    window.addEventListener("hashchange", updateView);
    return () => window.removeEventListener("hashchange", updateView);
  }, [initialView]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#searches" aria-label="Dealfinder saved searches" onClick={() => setView("searches")}>
          <span className="wordmark-mark" aria-hidden="true">df</span>
          <span>{appName}</span>
        </a>
        <p className="local-label"><span aria-hidden="true" />Private workspace</p>
      </header>

      <aside className="sidebar" aria-label="Primary navigation">
        <nav>
          <a href="#searches" aria-current={view === "searches" ? "page" : undefined} onClick={() => setView("searches")}>Searches</a>
          <a href="#inbox" aria-current={view === "inbox" ? "page" : undefined} onClick={() => setView("inbox")}>Inbox</a>
          <span className="nav-disabled" aria-disabled="true">Sources</span>
          <span className="nav-disabled" aria-disabled="true">Activity</span>
        </nav>
        <div className="sidebar-meta">
          <p className="sidebar-note">Local-first<br />Europe/Lisbon</p>
          <p
            className="distance-attribution"
            title={distanceDisclosure}
          >
            <strong>Distance</strong>
            Approx. straight-line<br />No routes · offline PT centroids
          </p>
        </div>
      </aside>

      <main id={view} className={`workspace ${view === "searches" ? "search-workspace" : "inbox-workspace"}`}>
        <HealthRail state={healthState} onRetry={() => void refreshHealth()} />
        {view === "searches" ? <><BrowserStatusPanel
          {...(browserClient === undefined ? {} : { client: browserClient })}
          {...(initialBrowserStatus === undefined ? {} : { initialStatus: initialBrowserStatus })}
        />
        <FacebookHealthPanel
          {...(facebookHealthClient === undefined ? {} : { client: facebookHealthClient })}
          {...(initialFacebookHealth === undefined ? {} : { initialHealth: initialFacebookHealth })}
        />
        <SearchDashboard
          {...(searchesClient === undefined ? {} : { client: searchesClient })}
          {...(initialSearches === undefined ? {} : { initialSearches })}
        /></> : <ListingDashboard
          {...(listingsClient === undefined ? {} : { client: listingsClient })}
          {...(initialListings === undefined ? {} : { initialListings })}
        />}
      </main>
    </div>
  );
}

interface HealthRailProps {
  state: HealthState;
  onRetry(): void;
}

function HealthRail({ state, onRetry }: HealthRailProps): ReactElement {
  const ready = state.phase === "ready" && state.health.status === "ok";
  const status = state.phase === "loading"
    ? "Checking system"
    : ready
      ? "System ready"
      : "Needs attention";

  return (
    <aside className={`health-strip health-${state.phase}`} aria-live="polite" aria-label="Local system status">
      <p className="health-status"><span aria-hidden="true" />{status}</p>
      <dl>
        <div>
          <dt>Server</dt>
          <dd>{ready ? "Online" : state.phase === "loading" ? "Checking" : "Unavailable"}</dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd>{ready ? `SQLite / schema ${padVersion(state.health.database.schemaVersion)}` : "—"}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>Loopback only</dd>
        </div>
      </dl>

      {state.phase === "unavailable" ? <div className="health-error"><p>{state.message}. Check that the local server is running.</p><button type="button" onClick={onRetry}>Check again</button></div> : null}
    </aside>
  );
}

function padVersion(version: number | null): string {
  return version === null ? "—" : String(version).padStart(2, "0");
}
