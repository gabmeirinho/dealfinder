export const FACEBOOK_FAILURE_KINDS = [
  "checkpoint",
  "login_required",
  "marketplace_restricted",
  "consent_required",
  "rate_limited",
  "empty_results",
  "partial_load",
  "selector_contract"
] as const;

export type FacebookFailureKind = typeof FACEBOOK_FAILURE_KINDS[number];
export type AcquisitionPauseScope = "browser" | "source" | "search";

export interface DiagnosticArtifactMetadata {
  id: string;
  failureKind: FacebookFailureKind;
  searchId: string | null;
  createdAt: string;
  expiresAt: string;
  screenshotPath: string | null;
  domPath: string | null;
}

export interface AcquisitionPause {
  id: string;
  scope: AcquisitionPauseScope;
  scopeKey: string;
  searchId: string | null;
  failureKind: FacebookFailureKind;
  detail: string;
  diagnosticId: string | null;
  pausedAt: string;
  resolvedAt: string | null;
}

export interface FacebookAcquisitionHealth {
  status: "ok" | "paused";
  pauses: readonly AcquisitionPause[];
  diagnosticsRetentionDays: 7;
  automaticSelectorRepair: false;
  screenshotsExternal: false;
}
