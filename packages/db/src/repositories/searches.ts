import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  assertValidVehicleSearch,
  type VehicleSearch,
  type VehicleSearchCriteria,
  type VehicleSearchDraft
} from "@dealfinder/domain";

interface SearchRow {
  id: string;
  name: string;
  priority: number;
  is_active: number;
  criteria_json: string;
  location_mode: "radius" | "nationwide";
  origin: string | null;
  radius_km: number | null;
  created_at: string;
  updated_at: string;
}

/** Persists only source-neutral criteria; adapter-specific state belongs elsewhere. */
export class SearchesRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  public create(draft: VehicleSearchDraft): VehicleSearch {
    const search = assertValidVehicleSearch(draft);
    const id = this.createId();
    const timestamp = this.now().toISOString();

    this.database
      .prepare(`
        INSERT INTO searches (
          id, name, priority, is_active, criteria_json,
          location_mode, origin, radius_km, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        search.name,
        search.priority,
        search.active ? 1 : 0,
        JSON.stringify(search.criteria),
        search.location.mode,
        search.location.origin,
        search.location.radiusKm,
        timestamp,
        timestamp
      );

    const persisted = this.get(id);
    if (persisted === undefined) throw new Error(`Failed to persist search: ${id}`);
    return persisted;
  }

  public get(id: string): VehicleSearch | undefined {
    validateId(id);
    const row = this.database
      .prepare(`
        SELECT id, name, priority, is_active, criteria_json,
               location_mode, origin, radius_km, created_at, updated_at
        FROM searches
        WHERE id = ?
      `)
      .get(id) as unknown as SearchRow | undefined;

    return row === undefined ? undefined : mapSearch(row);
  }

  public list(): VehicleSearch[] {
    const rows = this.database
      .prepare(`
        SELECT id, name, priority, is_active, criteria_json,
               location_mode, origin, radius_km, created_at, updated_at
        FROM searches
        ORDER BY is_active DESC, priority ASC, created_at ASC, id ASC
      `)
      .all() as unknown as SearchRow[];

    return rows.map(mapSearch);
  }

  public update(id: string, draft: VehicleSearchDraft): VehicleSearch | undefined {
    validateId(id);
    const search = assertValidVehicleSearch(draft);
    const timestamp = this.now().toISOString();
    const result = this.database
      .prepare(`
        UPDATE searches SET
          name = ?,
          priority = ?,
          is_active = ?,
          criteria_json = ?,
          location_mode = ?,
          origin = ?,
          radius_km = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        search.name,
        search.priority,
        search.active ? 1 : 0,
        JSON.stringify(search.criteria),
        search.location.mode,
        search.location.origin,
        search.location.radiusKm,
        timestamp,
        id
      );

    return result.changes === 0 ? undefined : this.get(id);
  }

  public delete(id: string): boolean {
    validateId(id);
    return this.database.prepare("DELETE FROM searches WHERE id = ?").run(id).changes > 0;
  }
}

function mapSearch(row: SearchRow): VehicleSearch {
  let criteria: VehicleSearchCriteria;
  try {
    criteria = JSON.parse(row.criteria_json) as VehicleSearchCriteria;
  } catch (error: unknown) {
    throw new Error(`Search ${row.id} contains invalid criteria JSON`, { cause: error });
  }

  const validated = assertValidVehicleSearch({
    name: row.name,
    priority: row.priority,
    active: row.is_active === 1,
    criteria,
    location: {
      mode: row.location_mode,
      origin: row.origin,
      radiusKm: row.radius_km
    }
  });

  return {
    id: row.id,
    ...validated,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateId(id: string): void {
  if (id.length === 0 || id.length > 100) {
    throw new Error("Search IDs must contain 1-100 characters");
  }
}
