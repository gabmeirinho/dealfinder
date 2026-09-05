export const SCAN_INTERVAL_MINUTES = 15 as const;
export const SCAN_INTERVAL_MAX_MINUTES = 30 as const;
export const INITIAL_SCAN_CARD_LIMIT = 300 as const;
export const KNOWN_LISTING_STOP_COUNT = 50 as const;

export interface ScanLimits {
  initialCardLimit: number;
  knownListingStopCount: number;
  maxCards: number;
  maxDurationSeconds: number;
}
export const DEFAULT_SCAN_LIMITS: Readonly<ScanLimits> = Object.freeze({
  initialCardLimit: INITIAL_SCAN_CARD_LIMIT,
  knownListingStopCount: KNOWN_LISTING_STOP_COUNT,
  maxCards: 1000,
  maxDurationSeconds: 120
});
export type ScanMode = "standard" | "deep";
export type ScanStopReason = "initial_limit" | "known_streak" | "card_limit" | "time_limit" | "results_end" | "no_progress";

export type ScanTrigger = "startup" | "scheduled" | "manual";
export type ScanRunState = "queued" | "running" | "succeeded" | "failed";

export interface ScanRun {
  mode?: ScanMode;
  stopReason?: ScanStopReason | null;
  id: string;
  searchId: string;
  trigger: ScanTrigger;
  state: ScanRunState;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cardsSeen: number;
  newCandidates: number;
  errorCode: string | null;
}

export interface ScanSchedule {
  searchId: string;
  lastScanAt: string | null;
  nextScanAt: string | null;
  consecutiveFailures: number;
  updatedAt: string;
}

export interface ScanQueueReceipt {
  runId: string;
  searchId: string;
  status: "pending";
  requestedAt: string;
}
