import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  validateFactCorrection,
  type FactCorrection,
  type NormalizedFactField,
  type ReusableNormalizationRule
} from "@dealfinder/domain";

export type RuleProposalStatus = "pending" | "approved" | "rejected";

interface CorrectionRow {
  id: string;
  listing_id: number;
  field: NormalizedFactField;
  value_json: string;
  reason: string | null;
  created_at: string;
}

interface ProposalRow {
  id: string;
  correction_id: string;
  field: NormalizedFactField;
  source_value_json: string;
  replacement_value_json: string;
  status: RuleProposalStatus;
  created_at: string;
  decided_at: string | null;
}

export interface ListingCorrection extends FactCorrection {
  id: string;
  listingId: number;
  reason: string | null;
  createdAt: string;
}

export interface NormalizationRuleProposal extends ReusableNormalizationRule {
  id: string;
  correctionId: string;
  status: RuleProposalStatus;
  createdAt: string;
  decidedAt: string | null;
}

export class CorrectionsRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly createId: () => string = randomUUID
  ) {}

  public create(
    listingId: number,
    correction: FactCorrection,
    reason: string | null,
    createdAt: string
  ): ListingCorrection {
    validateFactCorrection(correction);
    validateTimestamp(createdAt, "Created at");
    if (reason !== null && (reason.length === 0 || reason.length > 1000)) {
      throw new Error("Correction reason must contain 1-1000 characters");
    }
    const id = this.createId();
    this.database.prepare(`
      INSERT INTO listing_corrections (id, listing_id, field, value_json, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, listingId, correction.field, JSON.stringify(correction.value), reason, createdAt);
    return this.requireCorrection(id);
  }

  public listForListing(listingId: number): ListingCorrection[] {
    return (this.database.prepare(`
      SELECT id, listing_id, field, value_json, reason, created_at
      FROM listing_corrections WHERE listing_id = ? ORDER BY created_at ASC, id ASC
    `).all(listingId) as unknown as CorrectionRow[]).map(mapCorrection);
  }

  public proposeRule(
    correctionId: string,
    sourceValue: string | number | null,
    createdAt: string
  ): NormalizationRuleProposal {
    validateTimestamp(createdAt, "Created at");
    const correction = this.requireCorrection(correctionId);
    const existing = this.getProposalForCorrection(correctionId);
    if (existing !== undefined) return existing;
    const id = this.createId();
    this.database.prepare(`
      INSERT INTO normalization_rule_proposals (
        id, correction_id, field, source_value_json, replacement_value_json,
        status, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)
    `).run(
      id,
      correctionId,
      correction.field,
      JSON.stringify(sourceValue),
      JSON.stringify(correction.value),
      createdAt
    );
    return this.requireProposal(id);
  }

  public decideRule(
    proposalId: string,
    decision: "approved" | "rejected",
    decidedAt: string
  ): NormalizationRuleProposal {
    validateTimestamp(decidedAt, "Decided at");
    const current = this.requireProposal(proposalId);
    if (current.status === decision) return current;
    if (current.status !== "pending") {
      throw new Error(`Rule proposal ${proposalId} was already ${current.status}`);
    }
    this.database.prepare(`
      UPDATE normalization_rule_proposals SET status = ?, decided_at = ? WHERE id = ?
    `).run(decision, decidedAt, proposalId);
    return this.requireProposal(proposalId);
  }

  public listApprovedRules(): ReusableNormalizationRule[] {
    return (this.database.prepare(`
      SELECT id, correction_id, field, source_value_json, replacement_value_json,
             status, created_at, decided_at
      FROM normalization_rule_proposals WHERE status = 'approved'
      ORDER BY decided_at ASC, id ASC
    `).all() as unknown as ProposalRow[]).map(mapProposal).map(({ field, sourceValue, value }) => ({
      field,
      sourceValue,
      value
    }));
  }

  public getProposal(proposalId: string): NormalizationRuleProposal | undefined {
    const row = this.database.prepare(`
      SELECT id, correction_id, field, source_value_json, replacement_value_json,
             status, created_at, decided_at
      FROM normalization_rule_proposals WHERE id = ?
    `).get(proposalId) as unknown as ProposalRow | undefined;
    return row === undefined ? undefined : mapProposal(row);
  }

  public getProposalForCorrection(correctionId: string): NormalizationRuleProposal | undefined {
    const row = this.database.prepare(`
      SELECT id, correction_id, field, source_value_json, replacement_value_json,
             status, created_at, decided_at
      FROM normalization_rule_proposals WHERE correction_id = ?
    `).get(correctionId) as unknown as ProposalRow | undefined;
    return row === undefined ? undefined : mapProposal(row);
  }

  private requireCorrection(correctionId: string): ListingCorrection {
    const row = this.database.prepare(`
      SELECT id, listing_id, field, value_json, reason, created_at
      FROM listing_corrections WHERE id = ?
    `).get(correctionId) as unknown as CorrectionRow | undefined;
    if (row === undefined) throw new Error(`Correction not found: ${correctionId}`);
    return mapCorrection(row);
  }

  private requireProposal(proposalId: string): NormalizationRuleProposal {
    const proposal = this.getProposal(proposalId);
    if (proposal === undefined) throw new Error(`Rule proposal not found: ${proposalId}`);
    return proposal;
  }
}

function mapCorrection(row: CorrectionRow): ListingCorrection {
  return {
    id: row.id,
    listingId: row.listing_id,
    field: row.field,
    value: parseScalar(row.value_json),
    reason: row.reason,
    createdAt: row.created_at
  };
}

function mapProposal(row: ProposalRow): NormalizationRuleProposal {
  return {
    id: row.id,
    correctionId: row.correction_id,
    field: row.field,
    sourceValue: parseScalar(row.source_value_json),
    value: parseScalar(row.replacement_value_json),
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at
  };
}

function parseScalar(json: string): string | number | null {
  const value: unknown = JSON.parse(json);
  if (value !== null && typeof value !== "string" && typeof value !== "number") {
    throw new Error("Stored correction value is invalid");
  }
  return value;
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}
