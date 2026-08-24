export const SCAN_INTERVAL_MINUTES = 15 as const;
export const SCAN_INTERVAL_MAX_MINUTES = 30 as const;
export const INITIAL_SCAN_CARD_LIMIT = 300 as const;
export const KNOWN_LISTING_STOP_COUNT = 50 as const;

export type ScanTrigger = "startup" | "scheduled" | "manual";
export type ScanRunState = "queued" | "running" | "succeeded" | "failed";

export interface ScanRun {
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
