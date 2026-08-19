import { createSettingsMigration } from "./001-create-settings.js";
import { createSearchesMigration } from "./002-create-searches.js";
import type { Migration } from "./types.js";

export const allMigrations: readonly Migration[] = [
  createSettingsMigration,
  createSearchesMigration
];

export const LATEST_SCHEMA_VERSION =
  allMigrations.at(-1)?.version ?? 0;
