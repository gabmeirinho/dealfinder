import type { Migration } from "./types.js";

export const createNormalizedVehicleFactsMigration: Migration = {
  version: 8,
  name: "create_normalized_vehicle_facts",
  up(database) {
    database.exec(`
      CREATE TABLE normalized_vehicle_facts (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        raw_observation_id INTEGER NOT NULL REFERENCES raw_candidate_observations(id) ON DELETE RESTRICT,
        original_title TEXT NOT NULL CHECK (length(original_title) BETWEEN 1 AND 1000),
        original_description TEXT,
        original_displayed_price TEXT,
        original_card_facts_json TEXT NOT NULL CHECK (json_valid(original_card_facts_json)),
        price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
        vehicle_year INTEGER CHECK (vehicle_year IS NULL OR vehicle_year BETWEEN 1950 AND 9999),
        mileage_km INTEGER CHECK (mileage_km IS NULL OR mileage_km >= 0),
        make TEXT,
        model TEXT,
        variant TEXT,
        fuel TEXT CHECK (fuel IS NULL OR fuel IN ('petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'lpg', 'other')),
        transmission TEXT CHECK (transmission IS NULL OR transmission IN ('manual', 'automatic')),
        power_hp INTEGER CHECK (power_hp IS NULL OR power_hp >= 0),
        seller_type TEXT CHECK (seller_type IS NULL OR seller_type IN ('private', 'dealer')),
        seller_rating REAL CHECK (seller_rating IS NULL OR seller_rating BETWEEN 0 AND 5),
        seller_rating_count INTEGER CHECK (seller_rating_count IS NULL OR seller_rating_count >= 0),
        seller_inventory_size INTEGER CHECK (seller_inventory_size IS NULL OR seller_inventory_size >= 0),
        financing INTEGER NOT NULL CHECK (financing IN (0, 1)),
        monthly_payment INTEGER NOT NULL CHECK (monthly_payment IN (0, 1)),
        deposit INTEGER NOT NULL CHECK (deposit IN (0, 1)),
        damaged INTEGER NOT NULL CHECK (damaged IN (0, 1)),
        imported INTEGER NOT NULL CHECK (imported IN (0, 1)),
        evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
        parser_version INTEGER NOT NULL CHECK (parser_version >= 1),
        normalized_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE listing_risk_assessments (
        listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
        high_risk_verify_price INTEGER NOT NULL CHECK (high_risk_verify_price IN (0, 1)),
        reasons_json TEXT NOT NULL CHECK (json_valid(reasons_json)),
        assessed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE listing_match_evaluations (
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
        eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
        hard_failures_json TEXT NOT NULL CHECK (json_valid(hard_failures_json)),
        soft_contributions_json TEXT NOT NULL CHECK (json_valid(soft_contributions_json)),
        evaluated_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, search_id)
      ) WITHOUT ROWID, STRICT;

      CREATE TABLE listing_corrections (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        field TEXT NOT NULL CHECK (field IN (
          'priceCents', 'year', 'mileageKm', 'make', 'model', 'variant',
          'fuel', 'transmission', 'powerHp', 'sellerType'
        )),
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE normalization_rule_proposals (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
        correction_id TEXT NOT NULL UNIQUE REFERENCES listing_corrections(id) ON DELETE CASCADE,
        field TEXT NOT NULL CHECK (field IN (
          'priceCents', 'year', 'mileageKm', 'make', 'model', 'variant',
          'fuel', 'transmission', 'powerHp', 'sellerType'
        )),
        source_value_json TEXT NOT NULL CHECK (json_valid(source_value_json)),
        replacement_value_json TEXT NOT NULL CHECK (json_valid(replacement_value_json)),
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at TEXT NOT NULL,
        decided_at TEXT
      ) STRICT;

      CREATE INDEX normalized_vehicle_make_model_idx
        ON normalized_vehicle_facts (make, model, vehicle_year, mileage_km);
      CREATE INDEX listing_match_evaluations_search_idx
        ON listing_match_evaluations (search_id, eligible, listing_id);
      CREATE INDEX listing_corrections_listing_idx
        ON listing_corrections (listing_id, created_at ASC, id ASC);
      CREATE INDEX normalization_rules_status_idx
        ON normalization_rule_proposals (status, field, id);
    `);
  }
};
