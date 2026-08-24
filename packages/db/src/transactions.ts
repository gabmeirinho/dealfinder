import type { DatabaseSync } from "node:sqlite";

const transactionDepth = new WeakMap<DatabaseSync, number>();

/** Runs work atomically. Savepoints make this helper safe to nest. */
export function withTransaction<T>(
  database: DatabaseSync,
  operation: () => T
): T {
  const depth = transactionDepth.get(database) ?? 0;
  const savepoint = `dealfinder_transaction_${depth + 1}`;

  database.exec(`SAVEPOINT ${savepoint}`);
  transactionDepth.set(database, depth + 1);

  try {
    const result = operation();
    database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error: unknown) {
    database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  } finally {
    if (depth === 0) {
      transactionDepth.delete(database);
    } else {
      transactionDepth.set(database, depth);
    }
  }
}
