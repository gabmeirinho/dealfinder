import type {
  ManagedVehicleSearch,
  SearchValidationIssue,
  VehicleSearch
} from "@dealfinder/domain";
import type { SearchSourceVerification } from "@dealfinder/db";

import { fingerprintSearchCriteria } from "../search-verification/fingerprint.js";

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

export function presentSearch(
  search: VehicleSearch,
  verification?: SearchSourceVerification
): ManagedVehicleSearch {
  const verificationState = verification === undefined
    ? "unverified"
    : verification.criteriaFingerprint === fingerprintSearchCriteria(search)
      ? "verified"
      : "stale";
  return {
    ...search,
    lastScanAt: null,
    nextScanAt: null,
    sourceVerification: {
      state: verificationState,
      verifiedAt: verification?.verifiedAt ?? null
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
