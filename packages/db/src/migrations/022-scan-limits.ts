import type { Migration } from "./types.js";

export const scanLimitsMigration: Migration = {
  version: 22,
  name: "scan_limits",
  up(database) {
    database.exec(`
      ALTER TABLE searches ADD COLUMN scan_limits_json TEXT NOT NULL DEFAULT '{"initialCardLimit":300,"knownListingStopCount":50,"maxCards":1000,"maxDurationSeconds":120}' CHECK(json_valid(scan_limits_json));
      ALTER TABLE scan_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'standard' CHECK(mode IN ('standard', 'deep'));
      ALTER TABLE scan_runs ADD COLUMN stop_reason TEXT CHECK(stop_reason IS NULL OR stop_reason IN ('initial_limit', 'known_streak', 'card_limit', 'time_limit', 'results_end', 'no_progress'));
    `);
  }
};
