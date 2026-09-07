import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Required only for SQLite table rebuilds referenced by child tables. */
  readonly disableForeignKeys?: boolean;
  up(database: DatabaseSync): void;
}
