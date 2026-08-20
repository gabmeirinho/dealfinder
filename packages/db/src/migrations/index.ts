import { createSettingsMigration } from "./001-create-settings.js";
import { createSearchesMigration } from "./002-create-searches.js";
import { createSearchSourcesMigration } from "./003-create-search-sources.js";
import type { Migration } from "./types.js";

export const allMigrations: readonly Migration[] = [
  createSettingsMigration,
  createSearchesMigration,
  createSearchSourcesMigration
];

export const LATEST_SCHEMA_VERSION =
  allMigrations.at(-1)?.version ?? 0;
