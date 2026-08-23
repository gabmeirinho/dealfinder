import type {
  ManagedVehicleSearch,
  ScanQueueReceipt,
  ScanSchedule,
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

export type SearchScanRequestResponse = ScanQueueReceipt;

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
  verification?: SearchSourceVerification,
  schedule?: ScanSchedule
): ManagedVehicleSearch {
  const verificationState = verification === undefined
    ? "unverified"
    : verification.criteriaFingerprint === fingerprintSearchCriteria(search)
      ? "verified"
      : "stale";
  return {
    ...search,
    lastScanAt: schedule?.lastScanAt ?? null,
    nextScanAt: schedule?.nextScanAt ?? null,
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
