export const packageName = "@dealfinder/db" as const;

export { openDatabase } from "./connection.js";
export type {
  DatabaseConnection,
  OpenDatabaseOptions
} from "./connection.js";
export {
  allMigrations,
  LATEST_SCHEMA_VERSION
} from "./migrations/index.js";
export type { Migration } from "./migrations/types.js";
export { runMigrations } from "./migration-runner.js";
export type { MigrationResult } from "./migration-runner.js";
export { SettingsRepository } from "./repositories/settings-repository.js";
export { SearchesRepository } from "./repositories/searches.js";
export { SearchSourcesRepository } from "./repositories/search-sources.js";
export type {
  SaveSearchSourceVerification,
  SearchSourceVerification
} from "./repositories/search-sources.js";
export { RawCandidatesRepository } from "./repositories/raw-candidates.js";
export type {
  RawCandidate,
  RawCandidateObservation,
  SaveRawCandidateObservation,
  SavedRawCandidateObservation
} from "./repositories/raw-candidates.js";
export { ScanRunsRepository } from "./repositories/scan-runs.js";
export type {
  CompleteScanRun,
  FailScanRun
} from "./repositories/scan-runs.js";
export { FacebookHealthRepository } from "./repositories/facebook-health.js";
export type {
  CreateAcquisitionPause,
  CreateDiagnosticArtifact
} from "./repositories/facebook-health.js";
export { ListingsRepository } from "./repositories/listings.js";
export type {
  IngestListingObservation,
  IngestedListingObservation,
  Listing,
  ListingEvent,
  ListingPricePoint
} from "./repositories/listings.js";
export { NormalizedVehiclesRepository } from "./repositories/normalized-vehicles.js";
export type {
  StoredMatchEvaluation,
  StoredNormalizedVehicle,
  StoredRiskAssessment
} from "./repositories/normalized-vehicles.js";
export { CorrectionsRepository } from "./repositories/corrections.js";
export type {
  ListingCorrection,
  NormalizationRuleProposal,
  RuleProposalStatus
} from "./repositories/corrections.js";
export { GeocodingRepository } from "./repositories/geocoding.js";
export type {
  CachedLocality,
  StoredListingDistance
} from "./repositories/geocoding.js";
export { EnrichmentProcessingRepository } from "./repositories/enrichment-processing.js";
export type {
  EnrichmentRequestFailure,
  ProcessingClaim,
  ProcessingControl,
  ProcessingQueueItem,
  ProcessingQueueState,
  StoredEnrichment
} from "./repositories/enrichment-processing.js";
export { withTransaction } from "./transactions.js";
