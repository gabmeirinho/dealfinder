import type { DatabaseSync } from "node:sqlite";

import type {
  NormalizedVehicleFacts,
  VehicleMatchEvaluation,
  VehicleRiskAssessment
} from "@dealfinder/domain";

interface FactsRow {
  listing_id: number;
  raw_observation_id: number;
  original_title: string;
  original_description: string | null;
  original_displayed_price: string | null;
  original_card_facts_json: string;
  price_cents: number | null;
  vehicle_year: number | null;
  mileage_km: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  fuel: NormalizedVehicleFacts["fuel"];
  transmission: NormalizedVehicleFacts["transmission"];
  power_hp: number | null;
  seller_type: NormalizedVehicleFacts["seller"]["type"];
  seller_rating: number | null;
  seller_rating_count: number | null;
  seller_inventory_size: number | null;
  financing: number;
  monthly_payment: number;
  deposit: number;
  damaged: number;
  imported: number;
  evidence_json: string;
  parser_version: number;
  normalized_at: string;
}

interface RiskRow {
  listing_id: number;
  high_risk_verify_price: number;
  reasons_json: string;
  assessed_at: string;
}

interface MatchRow {
  listing_id: number;
  search_id: string;
  eligible: number;
  hard_failures_json: string;
  soft_contributions_json: string;
  evaluated_at: string;
}

export interface StoredNormalizedVehicle {
  listingId: number;
  rawObservationId: number;
  facts: NormalizedVehicleFacts;
  parserVersion: number;
  normalizedAt: string;
}

export interface StoredRiskAssessment extends VehicleRiskAssessment {
  listingId: number;
  assessedAt: string;
}

export interface StoredMatchEvaluation extends VehicleMatchEvaluation {
  listingId: number;
  searchId: string;
  evaluatedAt: string;
}

export class NormalizedVehiclesRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public saveFacts(
    listingId: number,
    rawObservationId: number,
    facts: NormalizedVehicleFacts,
    normalizedAt: string,
    parserVersion = 1
  ): StoredNormalizedVehicle {
    validateTimestamp(normalizedAt, "Normalized at");
    if (!Number.isSafeInteger(parserVersion) || parserVersion < 1) {
      throw new Error("Parser version must be a positive integer");
    }
    this.database.prepare(`
      INSERT INTO normalized_vehicle_facts (
        listing_id, raw_observation_id, original_title, original_description,
        original_displayed_price, original_card_facts_json, price_cents, vehicle_year,
        mileage_km, make, model, variant, fuel, transmission, power_hp,
        seller_type, seller_rating, seller_rating_count, seller_inventory_size,
        financing, monthly_payment, deposit, damaged, imported, evidence_json,
        parser_version, normalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id) DO UPDATE SET
        raw_observation_id = excluded.raw_observation_id,
        original_title = excluded.original_title,
        original_description = excluded.original_description,
        original_displayed_price = excluded.original_displayed_price,
        original_card_facts_json = excluded.original_card_facts_json,
        price_cents = excluded.price_cents,
        vehicle_year = excluded.vehicle_year,
        mileage_km = excluded.mileage_km,
        make = excluded.make,
        model = excluded.model,
        variant = excluded.variant,
        fuel = excluded.fuel,
        transmission = excluded.transmission,
        power_hp = excluded.power_hp,
        seller_type = excluded.seller_type,
        seller_rating = excluded.seller_rating,
        seller_rating_count = excluded.seller_rating_count,
        seller_inventory_size = excluded.seller_inventory_size,
        financing = excluded.financing,
        monthly_payment = excluded.monthly_payment,
        deposit = excluded.deposit,
        damaged = excluded.damaged,
        imported = excluded.imported,
        evidence_json = excluded.evidence_json,
        parser_version = excluded.parser_version,
        normalized_at = excluded.normalized_at
    `).run(
      listingId,
      rawObservationId,
      facts.original.title,
      facts.original.description,
      facts.original.displayedPrice,
      JSON.stringify(facts.original.cardFacts),
      facts.priceCents,
      facts.year,
      facts.mileageKm,
      facts.make,
      facts.model,
      facts.variant,
      facts.fuel,
      facts.transmission,
      facts.powerHp,
      facts.seller.type,
      facts.seller.rating,
      facts.seller.ratingCount,
      facts.seller.inventorySize,
      bool(facts.indicators.financing),
      bool(facts.indicators.monthlyPayment),
      bool(facts.indicators.deposit),
      bool(facts.indicators.damaged),
      bool(facts.indicators.imported),
      JSON.stringify(facts.evidence),
      parserVersion,
      normalizedAt
    );
    return this.getFacts(listingId) as StoredNormalizedVehicle;
  }

  public getFacts(listingId: number): StoredNormalizedVehicle | undefined {
    const row = this.database.prepare(`
      SELECT ${FACT_COLUMNS} FROM normalized_vehicle_facts WHERE listing_id = ?
    `).get(listingId) as unknown as FactsRow | undefined;
    return row === undefined ? undefined : mapFacts(row);
  }

  public saveRisk(
    listingId: number,
    assessment: VehicleRiskAssessment,
    assessedAt: string
  ): StoredRiskAssessment {
    validateTimestamp(assessedAt, "Assessed at");
    this.database.prepare(`
      INSERT INTO listing_risk_assessments (
        listing_id, high_risk_verify_price, reasons_json, assessed_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(listing_id) DO UPDATE SET
        high_risk_verify_price = excluded.high_risk_verify_price,
        reasons_json = excluded.reasons_json,
        assessed_at = excluded.assessed_at
    `).run(listingId, bool(assessment.highRiskVerifyPrice), JSON.stringify(assessment.reasons), assessedAt);
    return this.getRisk(listingId) as StoredRiskAssessment;
  }

  public getRisk(listingId: number): StoredRiskAssessment | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, high_risk_verify_price, reasons_json, assessed_at
      FROM listing_risk_assessments WHERE listing_id = ?
    `).get(listingId) as unknown as RiskRow | undefined;
    if (row === undefined) return undefined;
    return {
      listingId: row.listing_id,
      highRiskVerifyPrice: row.high_risk_verify_price === 1,
      reasons: parseArray(row.reasons_json, "risk reasons"),
      assessedAt: row.assessed_at
    };
  }

  public saveMatch(
    listingId: number,
    searchId: string,
    evaluation: VehicleMatchEvaluation,
    evaluatedAt: string
  ): StoredMatchEvaluation {
    validateTimestamp(evaluatedAt, "Evaluated at");
    this.database.prepare(`
      INSERT INTO listing_match_evaluations (
        listing_id, search_id, eligible, hard_failures_json,
        soft_contributions_json, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id, search_id) DO UPDATE SET
        eligible = excluded.eligible,
        hard_failures_json = excluded.hard_failures_json,
        soft_contributions_json = excluded.soft_contributions_json,
        evaluated_at = excluded.evaluated_at
    `).run(
      listingId,
      searchId,
      bool(evaluation.eligible),
      JSON.stringify(evaluation.hardFailures),
      JSON.stringify(evaluation.softContributions),
      evaluatedAt
    );
    return this.getMatch(listingId, searchId) as StoredMatchEvaluation;
  }

  public getMatch(listingId: number, searchId: string): StoredMatchEvaluation | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, search_id, eligible, hard_failures_json,
             soft_contributions_json, evaluated_at
      FROM listing_match_evaluations WHERE listing_id = ? AND search_id = ?
    `).get(listingId, searchId) as unknown as MatchRow | undefined;
    if (row === undefined) return undefined;
    return {
      listingId: row.listing_id,
      searchId: row.search_id,
      eligible: row.eligible === 1,
      hardFailures: parseArray(row.hard_failures_json, "hard filter failures"),
      softContributions: parseArray(row.soft_contributions_json, "soft contributions"),
      evaluatedAt: row.evaluated_at
    };
  }
}

const FACT_COLUMNS = `
  listing_id, raw_observation_id, original_title, original_description,
  original_displayed_price, original_card_facts_json, price_cents, vehicle_year,
  mileage_km, make, model, variant, fuel, transmission, power_hp,
  seller_type, seller_rating, seller_rating_count, seller_inventory_size,
  financing, monthly_payment, deposit, damaged, imported, evidence_json,
  parser_version, normalized_at
`;

function mapFacts(row: FactsRow): StoredNormalizedVehicle {
  return {
    listingId: row.listing_id,
    rawObservationId: row.raw_observation_id,
    facts: {
      original: {
        title: row.original_title,
        description: row.original_description,
        displayedPrice: row.original_displayed_price,
        cardFacts: parseStringArray(row.original_card_facts_json, "original card facts")
      },
      priceCents: row.price_cents,
      year: row.vehicle_year,
      mileageKm: row.mileage_km,
      make: row.make,
      model: row.model,
      variant: row.variant,
      fuel: row.fuel,
      transmission: row.transmission,
      powerHp: row.power_hp,
      seller: {
        type: row.seller_type,
        rating: row.seller_rating,
        ratingCount: row.seller_rating_count,
        inventorySize: row.seller_inventory_size
      },
      indicators: {
        financing: row.financing === 1,
        monthlyPayment: row.monthly_payment === 1,
        deposit: row.deposit === 1,
        damaged: row.damaged === 1,
        imported: row.imported === 1
      },
      evidence: parseObject(row.evidence_json, "normalization evidence")
    },
    parserVersion: row.parser_version,
    normalizedAt: row.normalized_at
  };
}

function parseArray<T>(json: string, label: string): T[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error(`Stored ${label} are invalid`);
  return value as T[];
}

function parseStringArray(json: string, label: string): string[] {
  const value = parseArray<unknown>(json, label);
  if (!value.every((item) => typeof item === "string")) throw new Error(`Stored ${label} are invalid`);
  return value as string[];
}

function parseObject(json: string, label: string): NormalizedVehicleFacts["evidence"] {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Stored ${label} is invalid`);
  }
  return value as NormalizedVehicleFacts["evidence"];
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}
