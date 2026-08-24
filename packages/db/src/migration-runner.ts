import type { DatabaseSync } from "node:sqlite";

import {
  CREATE_MIGRATION_TABLE_SQL,
  MIGRATION_TABLE
} from "./schema/conventions.js";
import type { Migration } from "./migrations/types.js";
import { withTransaction } from "./transactions.js";

interface AppliedMigrationRow {
  version: number;
  name: string;
}

export interface MigrationResult {
  readonly currentVersion: number;
  readonly appliedVersions: readonly number[];
}

export function runMigrations(
  database: DatabaseSync,
  migrations: readonly Migration[],
  now: () => Date = () => new Date()
): MigrationResult {
  validateMigrations(migrations);
  database.exec(CREATE_MIGRATION_TABLE_SQL);

  const appliedRows = database
    .prepare(`SELECT version, name FROM ${MIGRATION_TABLE} ORDER BY version`)
    .all() as unknown as AppliedMigrationRow[];
  const migrationByVersion = new Map(
    migrations.map((migration) => [migration.version, migration])
  );

  for (const applied of appliedRows) {
    const migration = migrationByVersion.get(applied.version);

    if (migration === undefined) {
      throw new Error(
        `Database schema version ${applied.version} is newer than this application supports`
      );
    }

    if (migration.name !== applied.name) {
      throw new Error(
        `Migration ${applied.version} was recorded as ${applied.name}, expected ${migration.name}`
      );
    }
  }

  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  const newlyApplied: number[] = [];
  const recordMigration = database.prepare(`
    INSERT INTO ${MIGRATION_TABLE} (version, name, applied_at)
    VALUES (?, ?, ?)
  `);

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    withTransaction(database, () => {
      migration.up(database);
      recordMigration.run(
        migration.version,
        migration.name,
        now().toISOString()
      );
    });
    newlyApplied.push(migration.version);
  }

  return {
    currentVersion: migrations.at(-1)?.version ?? 0,
    appliedVersions: newlyApplied
  };
}

function validateMigrations(migrations: readonly Migration[]): void {
  let previousVersion = 0;
  const names = new Set<string>();

  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version !== previousVersion + 1) {
      throw new Error(
        `Migration versions must be consecutive positive integers; expected ${previousVersion + 1}`
      );
    }

    if (migration.name.trim() === "" || names.has(migration.name)) {
      throw new Error(`Migration names must be non-empty and unique: ${migration.name}`);
    }

    previousVersion = migration.version;
    names.add(migration.name);
  }
}
