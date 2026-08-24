import type {
  SearchVerificationConfirmation,
  SearchVerificationPreview,
  SearchVerificationRejection
} from "@dealfinder/domain";

import { SearchApiError, type SearchApiErrorBody } from "./searches.js";

export interface SearchVerificationApiClient {
  openFacebook(searchId: string): Promise<SearchVerificationPreview>;
  confirmFacebook(searchId: string): Promise<SearchVerificationConfirmation>;
  rejectFacebook(searchId: string): Promise<SearchVerificationRejection>;
}

export function createSearchVerificationApiClient(
  request: typeof fetch = fetch
): SearchVerificationApiClient {
  const send = async <T>(searchId: string, action: string): Promise<T> => {
    const response = await request(
      `/api/searches/${encodeURIComponent(searchId)}/verification/facebook/${action}`,
      { method: "POST", headers: { accept: "application/json" } }
    );
    const body = await parseJson(response);
    if (!response.ok) {
      const errorBody = body as SearchApiErrorBody;
      throw new SearchApiError(
        response.status,
        errorBody.error?.code ?? "REQUEST_FAILED",
        errorBody.error?.message ?? `Request failed with status ${response.status}`
      );
    }
    return (body as { verification: T }).verification;
  };

  return {
    openFacebook: (searchId) => send(searchId, "open"),
    confirmFacebook: (searchId) => send(searchId, "confirm"),
    rejectFacebook: (searchId) => send(searchId, "reject")
  };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SearchApiError(
      response.status,
      "INVALID_RESPONSE",
      "The local server returned an unreadable response"
    );
  }
}

export const searchVerificationApi = createSearchVerificationApiClient();
