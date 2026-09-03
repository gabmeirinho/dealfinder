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
export { DealScoresRepository } from "./repositories/deal-scores.js";
export type { StoredDealScore } from "./repositories/deal-scores.js";
export { DuplicatesRepository } from "./repositories/duplicates.js";
export { ListingReviewsRepository } from "./repositories/listing-reviews.js";
export type {
  ListingNote,
  ListingReview,
  ListingReviewState
} from "./repositories/listing-reviews.js";
export { ListingClassificationsRepository } from "./repositories/listing-classifications.js";
export type {
  ListingClassificationCandidate,
  StoredListingClassification
} from "./repositories/listing-classifications.js";
export { ListingDetailDescriptionsRepository } from "./repositories/listing-detail-descriptions.js";
export type { ListingDetailDescription } from "./repositories/listing-detail-descriptions.js";
export { ListingDetailFactsRepository } from "./repositories/listing-detail-facts.js";
export type {
  ListingDetailFactSnapshot,
  ListingDetailFactSource,
  ListingDetailFactValues,
  ListingDetailMileageSources,
  ListingDetailStructuredFacts
} from "./repositories/listing-detail-facts.js";
export type {
  SaveThumbnailMetadata,
  StoredDuplicateGroup,
  StoredDuplicateMember,
  StoredListingFingerprint,
  StoredThumbnailMetadata
} from "./repositories/duplicates.js";
export { withTransaction } from "./transactions.js";
