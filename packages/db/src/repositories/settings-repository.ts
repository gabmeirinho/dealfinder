import type { DatabaseSync } from "node:sqlite";

import type { Setting } from "@dealfinder/domain";

interface SettingRow {
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

const SENSITIVE_KEY_PATTERN =
  /(?:api[-_.]?key|authorization|cookie|credential|password|secret|session|token)/iu;

/** Stores non-sensitive preferences only. Credentials belong outside SQLite. */
export class SettingsRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date()
  ) {}

  public get(key: string): Setting | undefined {
    validateKey(key);
    const row = this.database
      .prepare(`
        SELECT key, value, created_at, updated_at
        FROM settings
        WHERE key = ?
      `)
      .get(key) as unknown as SettingRow | undefined;

    return row === undefined ? undefined : mapSetting(row);
  }

  public list(): Setting[] {
    const rows = this.database
      .prepare(`
        SELECT key, value, created_at, updated_at
        FROM settings
        ORDER BY key
      `)
      .all() as unknown as SettingRow[];

    return rows.map(mapSetting);
  }

  public set(key: string, value: string): Setting {
    validateKey(key);
    const timestamp = this.now().toISOString();

    this.database
      .prepare(`
        INSERT INTO settings (key, value, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(key, value, timestamp, timestamp);

    const setting = this.get(key);
    if (setting === undefined) {
      throw new Error(`Failed to persist setting: ${key}`);
    }
    return setting;
  }

  public delete(key: string): boolean {
    validateKey(key);
    const result = this.database
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(key);
    return result.changes > 0;
  }
}

function validateKey(key: string): void {
  if (key.length === 0 || key.length > 120 || key !== key.trim()) {
    throw new Error("Setting keys must be 1-120 characters without surrounding whitespace");
  }

  if (SENSITIVE_KEY_PATTERN.test(key)) {
    throw new Error(`Sensitive setting keys are not persisted: ${key}`);
  }
}

function mapSetting(row: SettingRow): Setting {
  return {
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
