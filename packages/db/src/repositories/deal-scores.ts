import type { DatabaseSync } from "node:sqlite";

import {
  DEAL_SCORE_VERSION,
  MINIMUM_COMPARABLES,
  type ComparableCohortCriteria,
  type DealScore,
  type DealScoreCalculation
} from "@dealfinder/domain";

import { withTransaction } from "../transactions.js";

interface ScoreRow {
  listing_id: number;
  search_id: string;
  score_version: number;
  assessment_json: string;
  market_data_status: "sufficient" | "insufficient";
  median_price_cents: number | null;
  scored_at: string;
  criteria_json: string;
  candidate_count: number;
  excluded_outlier_count: number;
  excluded_outlier_ids_json: string;
}

interface MemberRow {
  comparable_listing_id: number;
  price_cents: number;
}

export interface StoredDealScore extends DealScoreCalculation {
  listingId: number;
  searchId: string;
  scoredAt: string;
}

export class DealScoresRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public save(
    listingId: number,
    searchId: string,
    calculation: DealScoreCalculation,
    scoredAt: string
  ): StoredDealScore {
    validateTimestamp(scoredAt, "Scored at");
    validateCalculation(calculation);
    withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO comparable_cohorts (
          subject_listing_id, search_id, criteria_json, candidate_count,
          comparable_count, excluded_outlier_count, excluded_outlier_ids_json, median_price_cents,
          market_data_status, calculated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(subject_listing_id, search_id) DO UPDATE SET
          criteria_json = excluded.criteria_json,
          candidate_count = excluded.candidate_count,
          comparable_count = excluded.comparable_count,
          excluded_outlier_count = excluded.excluded_outlier_count,
          excluded_outlier_ids_json = excluded.excluded_outlier_ids_json,
          median_price_cents = excluded.median_price_cents,
          market_data_status = excluded.market_data_status,
          calculated_at = excluded.calculated_at
      `).run(
        listingId,
        searchId,
        JSON.stringify(calculation.cohort.criteria),
        calculation.cohort.candidateCount,
        calculation.cohort.members.length,
        calculation.cohort.excludedOutlierListingIds.length,
        JSON.stringify(calculation.cohort.excludedOutlierListingIds),
        calculation.cohort.medianPriceCents,
        calculation.cohort.marketDataStatus,
        scoredAt
      );
      this.database.prepare(`
        DELETE FROM comparable_cohort_members
        WHERE subject_listing_id = ? AND search_id = ?
      `).run(listingId, searchId);
      const insertMember = this.database.prepare(`
        INSERT INTO comparable_cohort_members (
          subject_listing_id, search_id, comparable_listing_id, price_cents, ordinal
        ) VALUES (?, ?, ?, ?, ?)
      `);
      calculation.cohort.members.forEach((member, ordinal) => {
        insertMember.run(listingId, searchId, member.listingId, member.priceCents, ordinal);
      });
      this.database.prepare(`
        INSERT INTO listing_deal_scores (
          listing_id, search_id, score_version, assessment_json,
          market_discount_percent, personal_fit_percent, confidence, scored_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(listing_id, search_id) DO UPDATE SET
          score_version = excluded.score_version,
          assessment_json = excluded.assessment_json,
          market_discount_percent = excluded.market_discount_percent,
          personal_fit_percent = excluded.personal_fit_percent,
          confidence = excluded.confidence,
          scored_at = excluded.scored_at
      `).run(
        listingId, searchId, calculation.score.version, JSON.stringify(calculation.score),
        calculation.score.marketValue.discountPercent, calculation.score.personalFit.percent,
        calculation.score.confidence.level, scoredAt
      );
    });
    return this.get(listingId, searchId) as StoredDealScore;
  }

  public get(listingId: number, searchId: string): StoredDealScore | undefined {
    const row = this.database.prepare(`
      SELECT score.listing_id, score.search_id, score.score_version, score.assessment_json,
             score.scored_at, cohort.criteria_json, cohort.market_data_status, cohort.median_price_cents,
             cohort.candidate_count, cohort.excluded_outlier_count, cohort.excluded_outlier_ids_json
      FROM listing_deal_scores score
      JOIN comparable_cohorts cohort
        ON cohort.subject_listing_id = score.listing_id AND cohort.search_id = score.search_id
      WHERE score.listing_id = ? AND score.search_id = ?
    `).get(listingId, searchId) as unknown as ScoreRow | undefined;
    return row === undefined ? undefined : this.map(row);
  }

  public listRanked(searchId: string): StoredDealScore[] {
    const rows = this.database.prepare(`
      SELECT score.listing_id, score.search_id, score.score_version, score.assessment_json,
             score.scored_at, cohort.criteria_json, cohort.market_data_status, cohort.median_price_cents,
             cohort.candidate_count, cohort.excluded_outlier_count, cohort.excluded_outlier_ids_json
      FROM listing_deal_scores score
      JOIN comparable_cohorts cohort
        ON cohort.subject_listing_id = score.listing_id AND cohort.search_id = score.search_id
      WHERE score.search_id = ?
      ORDER BY score.market_discount_percent DESC, score.personal_fit_percent DESC, score.listing_id ASC
    `).all(searchId) as unknown as ScoreRow[];
    return rows.map((row) => this.map(row));
  }

  public delete(listingId: number, searchId: string): boolean {
    const result = this.database.prepare(`
      DELETE FROM comparable_cohorts WHERE subject_listing_id = ? AND search_id = ?
    `).run(listingId, searchId);
    return Number(result.changes) === 1;
  }

  private map(row: ScoreRow): StoredDealScore {
    const members = (this.database.prepare(`
      SELECT comparable_listing_id, price_cents
      FROM comparable_cohort_members
      WHERE subject_listing_id = ? AND search_id = ?
      ORDER BY ordinal ASC
    `).all(row.listing_id, row.search_id) as unknown as MemberRow[]).map((member) => ({
      listingId: member.comparable_listing_id,
      priceCents: member.price_cents
    }));
    const marketDataLabel = row.market_data_status === "sufficient" ? "Market data available" : "Insufficient market data";
    return {
      listingId: row.listing_id,
      searchId: row.search_id,
      scoredAt: row.scored_at,
      cohort: {
        criteria: parseCriteria(row.criteria_json),
        candidateCount: row.candidate_count,
        members,
        excludedOutlierListingIds: parseIntegerArray(
          row.excluded_outlier_ids_json,
          row.excluded_outlier_count,
          "excluded outlier IDs"
        ),
        medianPriceCents: row.median_price_cents,
        marketDataStatus: row.market_data_status,
        marketDataLabel
      },
      score: parseAssessment(row.assessment_json, row.score_version)
    };
  }
}

function validateCalculation(calculation: DealScoreCalculation): void {
  if (calculation.score.version !== DEAL_SCORE_VERSION) throw new Error("Unsupported deal score version");
  const { marketValue: market, personalFit: fit } = calculation.score;
  if (fit.percent !== null && (!Number.isInteger(fit.percent) || fit.percent < 0 || fit.percent > 100)) {
    throw new Error("Personal fit must be an integer from zero to one hundred or null");
  }
  if (market.comparableCount !== calculation.cohort.members.length ||
      market.medianPriceCents !== calculation.cohort.medianPriceCents) {
    throw new Error("Market assessment does not match its cohort");
  }
  if (market.status !== "available" && (market.discountPercent !== null || market.position !== null)) {
    throw new Error("Unverified or insufficient market data cannot claim a discount");
  }
  if (market.discountPercent !== null && !Number.isFinite(market.discountPercent)) {
    throw new Error("Market discount must be finite");
  }
  if (calculation.cohort.candidateCount !==
      calculation.cohort.members.length + calculation.cohort.excludedOutlierListingIds.length) {
    throw new Error("Comparable candidate count is inconsistent");
  }
  const sufficient = calculation.cohort.members.length >= MINIMUM_COMPARABLES;
  if ((calculation.cohort.marketDataStatus === "sufficient") !== sufficient ||
      (market.status === "available" && !sufficient) ||
      (market.status === "insufficient_data" && sufficient)) {
    throw new Error("Market-data status is inconsistent");
  }
}

function parseCriteria(json: string): ComparableCohortCriteria {
  const value: unknown = JSON.parse(json);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored comparable criteria are invalid");
  }
  return value as ComparableCohortCriteria;
}

function parseAssessment(json: string, version: number): DealScore {
  const value = JSON.parse(json) as DealScore;
  if (version !== DEAL_SCORE_VERSION || value?.version !== DEAL_SCORE_VERSION ||
      value.marketValue === undefined || value.personalFit === undefined || value.confidence === undefined) {
    throw new Error("Stored assessment version is invalid");
  }
  return value;
}

function parseIntegerArray(json: string, expectedLength: number, label: string): number[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || value.length !== expectedLength ||
      !value.every((item) => Number.isSafeInteger(item) && item > 0)) {
    throw new Error(`Stored ${label} are invalid`);
  }
  return value as number[];
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}
