import type { Migration } from "./types.js";

export const standvirtualScanStateMigration: Migration = {
  version: 24,
  name: "standvirtual_scan_state",
  up(database) {
    database.exec("ALTER TABLE searches ADD COLUMN standvirtual_scan_json TEXT CHECK (standvirtual_scan_json IS NULL OR json_valid(standvirtual_scan_json))");
  }
};
