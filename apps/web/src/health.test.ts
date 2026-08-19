import { describe, expect, it, vi } from "vitest";

import { fetchHealth } from "./health.js";

describe("health client", () => {
  it("loads the local health endpoint", async () => {
    const body = {
      status: "ok" as const,
      database: { status: "ok" as const, schemaVersion: 1 },
      timestamp: "2026-01-01T00:00:00.000Z"
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(fetchHealth(request)).resolves.toEqual(body);
    expect(request).toHaveBeenCalledWith("/api/health", {
      headers: { accept: "application/json" }
    });
  });

  it("reports an actionable error for an unhealthy server", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 503 })
    );

    await expect(fetchHealth(request)).rejects.toThrow("Local server returned 503");
  });
});
