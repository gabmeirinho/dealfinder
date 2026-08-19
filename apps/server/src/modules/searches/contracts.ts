import type {
  ManagedVehicleSearch,
  SearchValidationIssue,
  VehicleSearch
} from "@dealfinder/domain";

export interface SearchResponse {
  search: ManagedVehicleSearch;
}

export interface SearchListResponse {
  searches: ManagedVehicleSearch[];
}

export interface SearchScanRequestResponse {
  searchId: string;
  status: "pending";
  requestedAt: string;
}

export interface SearchApiErrorResponse {
  error: {
    code: string;
    message: string;
    fieldErrors?: Readonly<Record<string, readonly string[]>>;
    details?: Readonly<Record<string, unknown>>;
  };
}

export function presentSearch(search: VehicleSearch): ManagedVehicleSearch {
  return {
    ...search,
    lastScanAt: null,
    nextScanAt: null,
    sourceVerification: {
      state: "unverified",
      verifiedAt: null
    }
  };
}

export function groupIssues(
  issues: readonly SearchValidationIssue[]
): Readonly<Record<string, readonly string[]>> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    (fieldErrors[issue.path] ??= []).push(issue.message);
  }
  return fieldErrors;
}
