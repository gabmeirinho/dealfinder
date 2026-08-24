import { describe, expect, it } from "vitest";

import { browserControlsFor, type BrowserStatus } from "./index.js";

const status = (state: BrowserStatus["state"]): BrowserStatus => ({
  state,
  attentionReason: state === "paused" ? "login_required" : null,
  attentionDetail: null,
  changedAt: "2026-01-01T00:00:00.000Z",
  profilePersistent: true,
  controlledTabs: state === "open" ? 1 : 0
});

describe("browser controls", () => {
  it("requires the explicit resume control for attention states", () => {
    expect(browserControlsFor(status("paused"))).toEqual({
      canOpen: false,
      canStop: false,
      canResume: true
    });
  });

  it("only opens a stopped browser and only stops an open browser", () => {
    expect(browserControlsFor(status("stopped"))).toEqual({
      canOpen: true,
      canStop: false,
      canResume: false
    });
    expect(browserControlsFor(status("open"))).toEqual({
      canOpen: false,
      canStop: true,
      canResume: false
    });
  });
});
