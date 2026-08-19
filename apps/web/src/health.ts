import type { HealthResponse } from "@dealfinder/domain";

export async function fetchHealth(
  request: typeof fetch = fetch
): Promise<HealthResponse> {
  const response = await request("/api/health", {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Local server returned ${response.status}`);
  }

  return await response.json() as HealthResponse;
}
