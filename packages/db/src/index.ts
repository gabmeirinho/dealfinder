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
export { withTransaction } from "./transactions.js";
