import type {
  ManagedVehicleSearch,
  VehicleSearchDraft
} from "@dealfinder/domain";

export interface SearchApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Readonly<Record<string, readonly string[]>>;
    details?: Readonly<Record<string, unknown>>;
  };
}

export class SearchApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Readonly<Record<string, readonly string[]>> = {},
    public readonly details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = "SearchApiError";
  }
}

export interface SearchApiClient {
  list(): Promise<ManagedVehicleSearch[]>;
  create(draft: VehicleSearchDraft, overrideActiveLimit?: boolean): Promise<ManagedVehicleSearch>;
  update(id: string, draft: VehicleSearchDraft, overrideActiveLimit?: boolean): Promise<ManagedVehicleSearch>;
  duplicate(id: string): Promise<ManagedVehicleSearch>;
  activate(id: string, overrideActiveLimit?: boolean): Promise<ManagedVehicleSearch>;
  pause(id: string): Promise<ManagedVehicleSearch>;
  delete(id: string): Promise<void>;
  reprioritize(searchIds: readonly string[]): Promise<ManagedVehicleSearch[]>;
  requestScan(id: string): Promise<{ searchId: string; status: "pending"; requestedAt: string }>;
}

export function createSearchApiClient(request: typeof fetch = fetch): SearchApiClient {
  return {
    list: async () => {
      const body = await send<{ searches: ManagedVehicleSearch[] }>(request, "/api/searches");
      return body.searches;
    },
    create: async (draft, overrideActiveLimit = false) => {
      const body = await send<{ search: ManagedVehicleSearch }>(request, "/api/searches", {
        method: "POST",
        body: JSON.stringify({ ...draft, overrideActiveLimit })
      });
      return body.search;
    },
    update: async (id, draft, overrideActiveLimit = false) => {
      const body = await send<{ search: ManagedVehicleSearch }>(
        request,
        `/api/searches/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          body: JSON.stringify({ ...draft, overrideActiveLimit })
        }
      );
      return body.search;
    },
    duplicate: async (id) => {
      const body = await send<{ search: ManagedVehicleSearch }>(
        request,
        `/api/searches/${encodeURIComponent(id)}/duplicate`,
        { method: "POST" }
      );
      return body.search;
    },
    activate: async (id, overrideActiveLimit = false) => {
      const body = await send<{ search: ManagedVehicleSearch }>(
        request,
        `/api/searches/${encodeURIComponent(id)}/activate`,
        { method: "POST", body: JSON.stringify({ overrideActiveLimit }) }
      );
      return body.search;
    },
    pause: async (id) => {
      const body = await send<{ search: ManagedVehicleSearch }>(
        request,
        `/api/searches/${encodeURIComponent(id)}/pause`,
        { method: "POST" }
      );
      return body.search;
    },
    delete: async (id) => {
      await send<void>(request, `/api/searches/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
    },
    reprioritize: async (searchIds) => {
      const body = await send<{ searches: ManagedVehicleSearch[] }>(
        request,
        "/api/searches/priorities",
        { method: "PUT", body: JSON.stringify({ searchIds }) }
      );
      return body.searches;
    },
    requestScan: (id) => send(
      request,
      `/api/searches/${encodeURIComponent(id)}/scan`,
      { method: "POST" }
    )
  };
}

export const searchApi = createSearchApiClient();

async function send<T>(
  request: typeof fetch,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await request(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers
    }
  });

  if (response.status === 204) return undefined as T;
  const body = await parseJson(response);
  if (!response.ok) {
    const errorBody = body as SearchApiErrorBody;
    throw new SearchApiError(
      response.status,
      errorBody.error?.code ?? "REQUEST_FAILED",
      errorBody.error?.message ?? `Request failed with status ${response.status}`,
      errorBody.error?.fieldErrors,
      errorBody.error?.details
    );
  }
  return body as T;
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
