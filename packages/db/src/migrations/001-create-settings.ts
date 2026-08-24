import type { Migration } from "./types.js";

export const createSettingsMigration: Migration = {
  version: 1,
  name: "create_settings",
  up(database) {
    database.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY CHECK (
          length(key) BETWEEN 1 AND 120
          AND key = trim(key)
        ),
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID
    `);
  }
};
