import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { HealthResponse } from "@dealfinder/domain";

import { fetchHealth } from "./health.js";

export const appName = "Dealfinder" as const;

export type HealthState =
  | { phase: "loading" }
  | { phase: "ready"; health: HealthResponse }
  | { phase: "unavailable"; message: string };

export interface AppProps {
  healthClient?: () => Promise<HealthResponse>;
  initialHealth?: HealthState;
}

export function App({
  healthClient = fetchHealth,
  initialHealth
}: AppProps = {}): ReactElement {
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#overview" aria-label="Dealfinder overview">
          <span className="wordmark-mark" aria-hidden="true">df</span>
          <span>{appName}</span>
        </a>
        <p className="local-label"><span aria-hidden="true" />Private workspace</p>
      </header>

      <aside className="sidebar" aria-label="Primary navigation">
        <nav>
          <a href="#overview" aria-current="page">Overview</a>
          <a href="#collection">Collection</a>
          <a href="#sources">Sources</a>
          <a href="#activity">Activity</a>
        </nav>
        <p className="sidebar-note">Local-first<br />Europe/Lisbon</p>
      </aside>

      <main id="overview" className="workspace">
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">Review desk / foundation</p>
          <h1 id="page-title">A clear place for<br />the deals worth keeping.</h1>
          <p className="intro-copy">
            The local workspace is running. Collection and review tools will
            arrive here as each source is connected.
          </p>
        </section>

        <HealthRail state={healthState} onRetry={() => void refreshHealth()} />

        <section id="collection" className="empty-panel" aria-labelledby="collection-title">
          <div>
            <p className="section-label">Collection queue</p>
            <h2 id="collection-title">No deals collected yet</h2>
          </div>
          <p>
            The workspace foundation is ready. Source setup and manual collection
            controls are the next pieces to land.
          </p>
        </section>

        <section className="foundation-grid" aria-label="Workspace foundation">
          <article id="sources">
            <p className="section-label">Data boundary</p>
            <h2>Stays on this machine</h2>
            <p>Preferences and deal data use the local SQLite store.</p>
          </article>
          <article id="activity">
            <p className="section-label">Runtime</p>
            <h2>Ready for background work</h2>
            <p>Services share one ordered startup and shutdown lifecycle.</p>
          </article>
        </section>
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
    <aside className={`health-rail health-${state.phase}`} aria-live="polite">
      <div className="rail-line" aria-hidden="true"><span /></div>
      <div className="health-heading">
        <p className="section-label">Live status</p>
        <p className="health-status"><span aria-hidden="true" />{status}</p>
      </div>

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

      {state.phase === "unavailable" ? (
        <div className="health-error">
          <p>{state.message}. Check that the local server is running.</p>
          <button type="button" onClick={onRetry}>Check again</button>
        </div>
      ) : null}
    </aside>
  );
}

function padVersion(version: number | null): string {
  return version === null ? "—" : String(version).padStart(2, "0");
}
