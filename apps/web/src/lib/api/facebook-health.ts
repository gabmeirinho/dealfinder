import type { FacebookAcquisitionHealth } from "@dealfinder/domain";

interface FacebookHealthResponse {
  facebook: FacebookAcquisitionHealth;
}

export interface FacebookHealthApiClient {
  status(): Promise<FacebookAcquisitionHealth>;
  resume(pauseId: string): Promise<FacebookAcquisitionHealth>;
}

export function createFacebookHealthApi(
  request: typeof fetch = fetch
): FacebookHealthApiClient {
  const send = async (path = "", method = "GET"): Promise<FacebookAcquisitionHealth> => {
    const response = await request(`/api/facebook-health${path}`, {
      method,
      headers: { accept: "application/json" }
    });
    const body = await response.json() as FacebookHealthResponse & {
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(body.error?.message ?? `Facebook health request returned ${response.status}`);
    }
    return body.facebook;
  };
  return {
    status: () => send(),
    resume: (pauseId) => send(`/pauses/${encodeURIComponent(pauseId)}/resume`, "POST")
  };
}

export const facebookHealthApi = createFacebookHealthApi();
