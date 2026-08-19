import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type DatabaseConnection } from "../connection.js";

export interface TestDatabase {
  readonly connection: DatabaseConnection;
  readonly filename: string;
  cleanup(): void;
}

export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "dealfinder-db-"));
  const filename = join(directory, "test.sqlite");
  const connection = openDatabase({ filename });

  return {
    connection,
    filename,
    cleanup: () => {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}
