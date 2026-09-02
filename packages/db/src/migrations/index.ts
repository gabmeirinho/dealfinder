import { createSettingsMigration } from "./001-create-settings.js";
import { createSearchesMigration } from "./002-create-searches.js";
import { createSearchSourcesMigration } from "./003-create-search-sources.js";
import { createRawCandidatesMigration } from "./004-create-raw-candidates.js";
import { createScanStateMigration } from "./005-create-scan-state.js";
import { createFacebookHealthMigration } from "./006-create-facebook-health.js";
import { createListingLifecycleMigration } from "./007-create-listing-lifecycle.js";
import { createNormalizedVehicleFactsMigration } from "./008-create-normalized-vehicle-facts.js";
import { createGeocodingCacheMigration } from "./009-create-geocoding-cache.js";
import { createEnrichmentProcessingMigration } from "./010-create-enrichment-processing.js";
import { createDealScoresMigration } from "./011-create-deal-scores.js";
import { createDuplicateGroupsMigration } from "./012-create-duplicate-groups.js";
import { createListingReviewWorkflowMigration } from "./013-create-listing-review-workflow.js";
import { createListingClassificationsMigration } from "./014-create-listing-classifications.js";
import { allowCancelledProcessingQueueMigration } from "./015-allow-cancelled-processing-queue.js";
import type { Migration } from "./types.js";

export const allMigrations: readonly Migration[] = [
  createSettingsMigration,
  createSearchesMigration,
  createSearchSourcesMigration,
  createRawCandidatesMigration,
  createScanStateMigration,
  createFacebookHealthMigration,
  createListingLifecycleMigration,
  createNormalizedVehicleFactsMigration,
  createGeocodingCacheMigration,
  createEnrichmentProcessingMigration,
  createDealScoresMigration,
  createDuplicateGroupsMigration,
  createListingReviewWorkflowMigration,
  createListingClassificationsMigration,
  allowCancelledProcessingQueueMigration
];

export const LATEST_SCHEMA_VERSION =
  allMigrations.at(-1)?.version ?? 0;
