import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { FacebookAcquisitionHealth } from "@dealfinder/domain";

import {
  facebookHealthApi,
  type FacebookHealthApiClient
} from "../../lib/api/facebook-health.js";

export interface FacebookHealthPanelProps {
  client?: FacebookHealthApiClient;
  initialHealth?: FacebookAcquisitionHealth;
}

export function FacebookHealthPanel({
  client = facebookHealthApi,
  initialHealth
}: FacebookHealthPanelProps): ReactElement {
  const [health, setHealth] = useState<FacebookAcquisitionHealth | null>(initialHealth ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setHealth(await client.status());
      setError(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Facebook health is unavailable");
    }
  }, [client]);

  useEffect(() => {
    if (initialHealth === undefined) void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [initialHealth, refresh]);

  const resume = async (pauseId: string): Promise<void> => {
    setPendingId(pauseId);
    setError(null);
    try {
      setHealth(await client.resume(pauseId));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Acquisition could not resume");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className={`facebook-health facebook-health-${health?.status ?? "loading"}`} aria-labelledby="facebook-health-title">
      <div>
        <p className="eyebrow">Acquisition safety</p>
        <h2 id="facebook-health-title">Facebook health</h2>
        <p aria-live="polite">
          {health === null
            ? "Checking acquisition state…"
            : health.status === "ok"
              ? "Scanning is clear to run."
              : "Scanning is paused until you review the failure."}
        </p>
      </div>

      {health?.pauses.map((pause) => (
        <article className="facebook-failure" key={pause.id}>
          <p><strong>{failureLabel(pause.failureKind)}</strong> · {scopeLabel(pause.scope)}</p>
          <p>{pause.detail}</p>
          <p className="browser-privacy">
            Diagnostics stay local and expire after {health.diagnosticsRetentionDays} days.
          </p>
          <button
            className="primary-action"
            type="button"
            disabled={pendingId !== null}
            onClick={() => void resume(pause.id)}
          >
            {pendingId === pause.id ? "Resuming…" : "Resume explicitly"}
          </button>
        </article>
      ))}

      {health === null || health.pauses.length === 0 ? null : (
        <p className="browser-privacy">Selector repair is manual only. Diagnostic screenshots are never sent externally.</p>
      )}
      {error === null ? null : <p role="alert" className="browser-command-error">{error}</p>}
    </section>
  );
}

function failureLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toLocaleUpperCase("en"));
}

function scopeLabel(scope: string): string {
  if (scope === "browser") return "browser paused";
  if (scope === "source") return "all Facebook searches paused";
  return "this search paused";
}
