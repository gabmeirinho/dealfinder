import type { BrowserStatus } from "@dealfinder/domain";

interface BrowserStatusResponse {
  browser: BrowserStatus;
}

interface BrowserErrorResponse {
  error?: { code?: string; message?: string };
}

export interface BrowserApiClient {
  status(): Promise<BrowserStatus>;
  open(): Promise<BrowserStatus>;
  stop(): Promise<BrowserStatus>;
  resume(): Promise<BrowserStatus>;
}

export function createBrowserApi(request: typeof fetch = fetch): BrowserApiClient {
  const send = async (path = "", method = "GET"): Promise<BrowserStatus> => {
    const response = await request(`/api/browser${path}`, {
      method,
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      const payload = await readError(response);
      throw new Error(payload.error?.message ?? `Browser request returned ${response.status}`);
    }
    return (await response.json() as BrowserStatusResponse).browser;
  };

  return {
    status: () => send(),
    open: () => send("/open", "POST"),
    stop: () => send("/stop", "POST"),
    resume: () => send("/resume", "POST")
  };
}

async function readError(response: Response): Promise<BrowserErrorResponse> {
  try {
    return await response.json() as BrowserErrorResponse;
  } catch {
    return {};
  }
}

export const browserApi = createBrowserApi();
