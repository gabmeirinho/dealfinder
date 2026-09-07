export interface StandvirtualScanReport {
  searchId: string;
  searchScope: "targeted" | "broad";
  pricePolicy: "strict" | "market_evidence";
  observedAt: string;
  collected: number;
  eligible: number;
  pagesScanned: number;
  stopReason: string;
  partialError: string | null;
  observationsInserted: number;
  listingsCreated: number;
  priceChanges: number;
  scoresCalculated: number;
}

export interface StandvirtualScanState {
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  report: StandvirtualScanReport | null;
}
