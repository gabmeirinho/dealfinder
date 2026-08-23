// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FacebookAcquisitionHealth } from "@dealfinder/domain";

import { FacebookHealthPanel } from "./FacebookHealthPanel.js";

afterEach(cleanup);

describe("Facebook health panel", () => {
  it("shows local evidence policy and requires an explicit resume", async () => {
    const user = userEvent.setup();
    const resume = vi.fn().mockResolvedValue(clearHealth());
    render(<FacebookHealthPanel
      initialHealth={pausedHealth()}
      client={{ status: async () => pausedHealth(), resume }}
    />);

    expect(screen.getByText("Scanning is paused until you review the failure.")).toBeTruthy();
    expect(screen.getByText(/Marketplace results did not finish loading/u)).toBeTruthy();
    expect(screen.getByText(/expire after 7 days/u)).toBeTruthy();
    expect(screen.getByText(/never sent externally/u)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Resume explicitly" }));

    expect(resume).toHaveBeenCalledWith("pause-1");
    expect(await screen.findByText("Scanning is clear to run.")).toBeTruthy();
  });
});

function pausedHealth(): FacebookAcquisitionHealth {
  return {
    status: "paused",
    pauses: [{
      id: "pause-1",
      scope: "search",
      scopeKey: "search-1",
      searchId: "search-1",
      failureKind: "partial_load",
      detail: "Marketplace results did not finish loading",
      diagnosticId: "diagnostic-1",
      pausedAt: "2026-08-23T09:00:00.000Z",
      resolvedAt: null
    }],
    diagnosticsRetentionDays: 7,
    automaticSelectorRepair: false,
    screenshotsExternal: false
  };
}

function clearHealth(): FacebookAcquisitionHealth {
  return {
    status: "ok",
    pauses: [],
    diagnosticsRetentionDays: 7,
    automaticSelectorRepair: false,
    screenshotsExternal: false
  };
}
