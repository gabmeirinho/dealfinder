import { useCallback, useEffect, useState, type ReactElement } from "react";

import {
  type BrowserAttentionReason,
  type BrowserStatus
} from "@dealfinder/domain";

import { browserApi, type BrowserApiClient } from "../../lib/api/browser.js";

type BrowserViewState =
  | { phase: "loading" }
  | { phase: "ready"; status: BrowserStatus }
  | { phase: "unavailable"; message: string };

export interface BrowserStatusPanelProps {
  client?: BrowserApiClient;
  initialStatus?: BrowserStatus;
}

const ATTENTION_COPY: Readonly<Record<BrowserAttentionReason, string>> = {
  browser_closed: "The browser window was closed. Reopen it only when you are ready to continue.",
  login_required: "Facebook needs you to sign in manually before acquisition can continue.",
  marketplace_denied: "Marketplace access was denied. Check access in the visible browser before resuming.",
  checkpoint: "Facebook presented a checkpoint. Resolve it manually in the visible browser before resuming.",
  consent_required: "Facebook needs a manual consent choice in the visible browser before acquisition can resume.",
  launch_failed: "Chromium could not open. Check the local installation, then try resuming."
};

export function BrowserStatusPanel({
  client = browserApi,
  initialStatus
}: BrowserStatusPanelProps): ReactElement {
  const [view, setView] = useState<BrowserViewState>(
    initialStatus === undefined ? { phase: "loading" } : { phase: "ready", status: initialStatus }
  );
  const [pending, setPending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setView({ phase: "loading" });
    try {
      setView({ phase: "ready", status: await client.status() });
    } catch (error: unknown) {
      setView({
        phase: "unavailable",
        message: error instanceof Error ? error.message : "Browser status is unavailable"
      });
    }
  }, [client]);

  useEffect(() => {
    if (initialStatus === undefined) void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [initialStatus, refresh]);

  const command = async (action: "open" | "stop" | "resume"): Promise<void> => {
    setPending(true);
    setCommandError(null);
    try {
      setView({ phase: "ready", status: await client[action]() });
    } catch (error: unknown) {
      setCommandError(error instanceof Error ? error.message : "The browser command failed");
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const status = view.phase === "ready" ? view.status : null;
  const controls = status === null ? null : {
    canOpen: status.state === "stopped",
    canStop: status.state === "open",
    canResume: status.state === "paused"
  };
  const presentation = presentState(status);

  return (
    <section className={`browser-console browser-${status?.state ?? view.phase}`} aria-labelledby="browser-title">
      <div className="browser-console-heading">
        <span className="browser-state-mark" aria-hidden="true" />
        <div>
          <h2 id="browser-title">Facebook browser</h2>
          <p aria-live="polite">{presentation.label}</p>
        </div>
      </div>

      <p className="browser-guidance">
        {view.phase === "unavailable"
          ? `${view.message}. Check that the local server is running.`
          : presentation.guidance}
      </p>

      <dl className="browser-facts">
        <div><dt>Window</dt><dd>{status === null ? "—" : status.state === "open" ? "Visible" : "Closed"}</dd></div>
        <div><dt>Profile</dt><dd>{status?.profilePersistent === true ? "Persistent" : "—"}</dd></div>
        <div><dt>Tabs</dt><dd>{status === null ? "—" : `${status.controlledTabs} controlled`}</dd></div>
      </dl>

      <div className="browser-actions">
        {controls?.canOpen === true ? (
          <button className="primary-action" type="button" disabled={pending} onClick={() => void command("open")}>
            {pending ? "Opening…" : "Open browser"}
          </button>
        ) : null}
        {controls?.canResume === true ? (
          <button className="primary-action" type="button" disabled={pending} onClick={() => void command("resume")}>
            {pending ? "Resuming…" : "Resume browser"}
          </button>
        ) : null}
        {controls?.canStop === true ? (
          <button className="secondary-action" type="button" disabled={pending} onClick={() => void command("stop")}>
            {pending ? "Stopping…" : "Stop browser"}
          </button>
        ) : null}
        {view.phase === "unavailable" ? (
          <button className="secondary-action" type="button" disabled={pending} onClick={() => void refresh(true)}>
            Check again
          </button>
        ) : null}
      </div>

      {commandError === null ? null : <p className="browser-command-error" role="alert">{commandError}</p>}
      <p className="browser-privacy">Sign in yourself in Chromium. DealFinder never asks for or stores your password.</p>
    </section>
  );
}

function presentState(status: BrowserStatus | null): { label: string; guidance: string } {
  if (status === null) return {
    label: "Checking browser",
    guidance: "Reading the local browser state…"
  };
  if (status.state === "stopped") return {
    label: "Stopped",
    guidance: "Open the visible browser when you want to sign in or prepare a Marketplace session."
  };
  if (status.state === "open") return {
    label: "Ready for manual use",
    guidance: "One controlled tab is open. Closing its window will pause acquisition."
  };
  if (status.state === "paused") return {
    label: "Paused — attention required",
    guidance: status.attentionDetail ?? (
      status.attentionReason === null
        ? "Review the visible browser state, then resume explicitly when it is safe to continue."
        : ATTENTION_COPY[status.attentionReason]
    )
  };
  return {
    label: status.state === "opening" ? "Opening…" : "Stopping…",
    guidance: "Wait for the visible browser operation to finish."
  };
}
