import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  AcquisitionPause,
  AcquisitionPauseScope,
  DiagnosticArtifactMetadata,
  FacebookFailureKind
} from "@dealfinder/domain";

interface DiagnosticRow {
  id: string;
  failure_kind: FacebookFailureKind;
  search_id: string | null;
  created_at: string;
  expires_at: string;
  screenshot_path: string | null;
  dom_path: string | null;
}

interface PauseRow {
  id: string;
  scope: AcquisitionPauseScope;
  scope_key: string;
  search_id: string | null;
  failure_kind: FacebookFailureKind;
  detail: string;
  diagnostic_id: string | null;
  paused_at: string;
  resolved_at: string | null;
}

export interface CreateDiagnosticArtifact {
  failureKind: FacebookFailureKind;
  searchId: string | null;
  createdAt: string;
  expiresAt: string;
  screenshotPath: string | null;
  domPath: string | null;
}

export interface CreateAcquisitionPause {
  scope: AcquisitionPauseScope;
  scopeKey: string;
  searchId: string | null;
  failureKind: FacebookFailureKind;
  detail: string;
  diagnosticId: string | null;
  pausedAt: string;
}

export class FacebookHealthRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly createId: () => string = randomUUID
  ) {}

  public createDiagnostic(input: CreateDiagnosticArtifact): DiagnosticArtifactMetadata {
    const id = this.createId();
    this.database.prepare(`
      INSERT INTO diagnostic_artifacts (
        id, failure_kind, search_id, created_at, expires_at, screenshot_path, dom_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.failureKind,
      input.searchId,
      input.createdAt,
      input.expiresAt,
      input.screenshotPath,
      input.domPath
    );
    return this.getDiagnostic(id) as DiagnosticArtifactMetadata;
  }

  public getDiagnostic(id: string): DiagnosticArtifactMetadata | undefined {
    const row = this.database.prepare(`
      SELECT id, failure_kind, search_id, created_at, expires_at, screenshot_path, dom_path
      FROM diagnostic_artifacts WHERE id = ?
    `).get(id) as unknown as DiagnosticRow | undefined;
    return row === undefined ? undefined : mapDiagnostic(row);
  }

  public listExpiredDiagnostics(at: string): DiagnosticArtifactMetadata[] {
    return (this.database.prepare(`
      SELECT id, failure_kind, search_id, created_at, expires_at, screenshot_path, dom_path
      FROM diagnostic_artifacts WHERE expires_at <= ? ORDER BY expires_at ASC, id ASC
    `).all(at) as unknown as DiagnosticRow[]).map(mapDiagnostic);
  }

  public deleteDiagnostic(id: string): boolean {
    return this.database.prepare("DELETE FROM diagnostic_artifacts WHERE id = ?")
      .run(id).changes === 1;
  }

  public pause(input: CreateAcquisitionPause): AcquisitionPause {
    const existing = this.database.prepare(`
      SELECT ${PAUSE_COLUMNS} FROM acquisition_pauses
      WHERE scope = ? AND scope_key = ? AND resolved_at IS NULL
    `).get(input.scope, input.scopeKey) as unknown as PauseRow | undefined;
    if (existing !== undefined) {
      this.database.prepare(`
        UPDATE acquisition_pauses
        SET failure_kind = ?, detail = ?, diagnostic_id = ?, paused_at = ?, search_id = ?
        WHERE id = ?
      `).run(
        input.failureKind,
        input.detail,
        input.diagnosticId,
        input.pausedAt,
        input.searchId,
        existing.id
      );
      return this.getPause(existing.id) as AcquisitionPause;
    }
    const id = this.createId();
    this.database.prepare(`
      INSERT INTO acquisition_pauses (
        id, scope, scope_key, search_id, failure_kind, detail,
        diagnostic_id, paused_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      input.scope,
      input.scopeKey,
      input.searchId,
      input.failureKind,
      input.detail,
      input.diagnosticId,
      input.pausedAt
    );
    return this.getPause(id) as AcquisitionPause;
  }

  public getPause(id: string): AcquisitionPause | undefined {
    const row = this.database.prepare(`
      SELECT ${PAUSE_COLUMNS} FROM acquisition_pauses WHERE id = ?
    `).get(id) as unknown as PauseRow | undefined;
    return row === undefined ? undefined : mapPause(row);
  }

  public listActivePauses(): AcquisitionPause[] {
    return (this.database.prepare(`
      SELECT ${PAUSE_COLUMNS} FROM acquisition_pauses
      WHERE resolved_at IS NULL ORDER BY paused_at DESC, id ASC
    `).all() as unknown as PauseRow[]).map(mapPause);
  }

  public isBlocked(searchId: string): boolean {
    return this.database.prepare(`
      SELECT 1 FROM acquisition_pauses
      WHERE resolved_at IS NULL AND (
        (scope = 'browser' AND scope_key = 'facebook-browser') OR
        (scope = 'source' AND scope_key = 'facebook') OR
        (scope = 'search' AND scope_key = ?)
      ) LIMIT 1
    `).get(searchId) !== undefined;
  }

  public resolve(id: string, resolvedAt: string): AcquisitionPause | undefined {
    const result = this.database.prepare(`
      UPDATE acquisition_pauses SET resolved_at = ?
      WHERE id = ? AND resolved_at IS NULL
    `).run(resolvedAt, id);
    return result.changes === 0 ? undefined : this.getPause(id);
  }
}

const PAUSE_COLUMNS = `
  id, scope, scope_key, search_id, failure_kind, detail,
  diagnostic_id, paused_at, resolved_at
`;

function mapDiagnostic(row: DiagnosticRow): DiagnosticArtifactMetadata {
  return {
    id: row.id,
    failureKind: row.failure_kind,
    searchId: row.search_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    screenshotPath: row.screenshot_path,
    domPath: row.dom_path
  };
}

function mapPause(row: PauseRow): AcquisitionPause {
  return {
    id: row.id,
    scope: row.scope,
    scopeKey: row.scope_key,
    searchId: row.search_id,
    failureKind: row.failure_kind,
    detail: row.detail,
    diagnosticId: row.diagnostic_id,
    pausedAt: row.paused_at,
    resolvedAt: row.resolved_at
  };
}
