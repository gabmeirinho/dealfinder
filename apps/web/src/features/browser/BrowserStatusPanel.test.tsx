// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserStatus } from "@dealfinder/domain";

import type { BrowserApiClient } from "../../lib/api/browser.js";
import { BrowserStatusPanel } from "./BrowserStatusPanel.js";

afterEach(cleanup);

describe("browser status controls", () => {
  it("opens the visible browser from a stopped state", async () => {
    const user = userEvent.setup();
    const openStatus = status("open");
    const open = vi.fn(async () => openStatus);
    const client = createClient({ open });
    render(<BrowserStatusPanel client={client} initialStatus={status("stopped")} />);

    await user.click(screen.getByRole("button", { name: "Open browser" }));

    expect(open).toHaveBeenCalledOnce();
    expect(await screen.findByText("Ready for manual use")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop browser" })).toBeTruthy();
  });

  it("shows only explicit resume when attention is required", async () => {
    const user = userEvent.setup();
    const resume = vi.fn(async () => status("open"));
    const client = createClient({ resume });
    render(
      <BrowserStatusPanel
        client={client}
        initialStatus={status("paused", "checkpoint")}
      />
    );

    expect(screen.queryByRole("button", { name: "Open browser" })).toBeNull();
    expect(screen.getByText("Paused — attention required")).toBeTruthy();
    expect(screen.getByText(/resolve it manually/iu)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Resume browser" }));
    expect(resume).toHaveBeenCalledOnce();
  });
});

function status(
  state: BrowserStatus["state"],
  attentionReason: BrowserStatus["attentionReason"] = null
): BrowserStatus {
  return {
    state,
    attentionReason,
    attentionDetail: null,
    changedAt: "2026-01-01T00:00:00.000Z",
    profilePersistent: true,
    controlledTabs: state === "open" ? 1 : 0
  };
}

function createClient(overrides: Partial<BrowserApiClient>): BrowserApiClient {
  return {
    status: async () => status("stopped"),
    open: async () => status("open"),
    stop: async () => status("stopped"),
    resume: async () => status("open"),
    ...overrides
  };
}
