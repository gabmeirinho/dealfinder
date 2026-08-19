import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("dashboard shell", () => {
  it("renders English navigation and loading health state", () => {
    const markup = renderToStaticMarkup(
      <App initialHealth={{ phase: "loading" }} initialSearches={[]} />
    );

    expect(markup).toContain("Dealfinder");
    expect(markup).toContain("Searches");
    expect(markup).toContain("Inbox");
    expect(markup).toContain("Checking system");
    expect(markup).toContain("Facebook browser");
    expect(markup).toContain("Checking browser");
    expect(markup).toContain("Saved searches");
    expect(markup).toContain("Set your first search");
  });

  it("renders the persistent browser boundary and manual-login guidance", () => {
    const markup = renderToStaticMarkup(
      <App
        initialHealth={{ phase: "loading" }}
        initialSearches={[]}
        initialBrowserStatus={{
          state: "stopped",
          attentionReason: null,
          attentionDetail: null,
          changedAt: "2026-01-01T00:00:00.000Z",
          profilePersistent: true,
          controlledTabs: 0
        }}
      />
    );

    expect(markup).toContain("Open browser");
    expect(markup).toContain("Profile");
    expect(markup).toContain("Persistent");
    expect(markup).toContain("never asks for or stores your password");
  });

  it("renders database health from the API contract", () => {
    const markup = renderToStaticMarkup(
      <App
        initialHealth={{
          phase: "ready",
          health: {
            status: "ok",
            database: { status: "ok", schemaVersion: 1 },
            timestamp: "2026-01-01T00:00:00.000Z"
          }
        }}
      />
    );

    expect(markup).toContain("System ready");
    expect(markup).toContain("SQLite / schema 01");
    expect(markup).toContain("Loopback only");
  });

  it("gives recovery guidance when health is unavailable", () => {
    const markup = renderToStaticMarkup(
      <App
        initialHealth={{
          phase: "unavailable",
          message: "Local server returned 503"
        }}
      />
    );

    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Check that the local server is running");
    expect(markup).toContain("Check again");
  });
});
