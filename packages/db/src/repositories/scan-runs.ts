import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  ScanMode,
  ScanStopReason,
  ScanRun,
  ScanSchedule,
  ScanTrigger
} from "@dealfinder/domain";

interface ScanRunRow {
  mode: ScanMode;
  stop_reason: ScanStopReason | null;
  id: string;
  search_id: string;
  trigger: ScanTrigger;
  state: ScanRun["state"];
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  cards_seen: number;
  new_candidates: number;
  error_code: string | null;
}

interface ScanScheduleRow {
  search_id: string;
  last_scan_at: string | null;
  next_scan_at: string | null;
  consecutive_failures: number;
  updated_at: string;
}

export interface CompleteScanRun {
  stopReason?: ScanStopReason;
  runId: string;
  completedAt: string;
  cardsSeen: number;
  newCandidates: number;
}

export interface FailScanRun {
  runId: string;
  completedAt: string;
  errorCode: string;
}

export class ScanRunsRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly createId: () => string = randomUUID
  ) {}

  public enqueue(searchId: string, trigger: ScanTrigger, requestedAt: string, mode: ScanMode = "standard"): ScanRun {
    if (mode !== "standard" && mode !== "deep") throw new Error("Invalid scan mode");
    validateId(searchId, "Search ID");
    validateTimestamp(requestedAt, "Requested at");
    const id = this.createId();
    this.database.prepare(`
      INSERT INTO scan_runs (id, search_id, trigger, state, requested_at, mode)
      VALUES (?, ?, ?, 'queued', ?, ?)
      ON CONFLICT DO NOTHING
    `).run(id, searchId, trigger, requestedAt, mode);
    // A manual deep request upgrades queued work; routine wakes never downgrade it.
    if (mode === "deep") this.database.prepare("UPDATE scan_runs SET mode = 'deep', trigger = 'manual' WHERE search_id = ? AND state = 'queued'").run(searchId);
    const queued = this.database.prepare(`
      SELECT ${RUN_COLUMNS}
      FROM scan_runs
      WHERE search_id = ? AND state = 'queued'
    `).get(searchId) as unknown as ScanRunRow | undefined;
    if (queued === undefined) throw new Error(`Failed to queue scan for search ${searchId}`);
    return mapRun(queued);
  }

  public listQueued(): ScanRun[] {
    return (this.database.prepare(`
      SELECT ${RUN_COLUMNS}
      FROM scan_runs
      WHERE state = 'queued'
      ORDER BY requested_at ASC, id ASC
    `).all() as unknown as ScanRunRow[]).map(mapRun);
  }

  public markRunning(runId: string, startedAt: string): ScanRun {
    validateTimestamp(startedAt, "Started at");
    const result = this.database.prepare(`
      UPDATE scan_runs
      SET state = 'running', started_at = ?, completed_at = NULL, error_code = NULL
      WHERE id = ? AND state = 'queued'
    `).run(startedAt, runId);
    if (result.changes !== 1) throw invalidTransition(runId, "running");
    return this.requireRun(runId);
  }

  public complete(input: CompleteScanRun): ScanRun {
    validateCount(input.cardsSeen, "Cards seen");
    validateCount(input.newCandidates, "New candidates");
    validateTimestamp(input.completedAt, "Completed at");
    const result = this.database.prepare(`
      UPDATE scan_runs
      SET state = 'succeeded', completed_at = ?, cards_seen = ?,
          new_candidates = ?, error_code = NULL, stop_reason = ?
      WHERE id = ? AND state = 'running'
    `).run(input.completedAt, input.cardsSeen, input.newCandidates, input.stopReason ?? null, input.runId);
    if (result.changes !== 1) throw invalidTransition(input.runId, "succeeded");
    return this.requireRun(input.runId);
  }

  public fail(input: FailScanRun): ScanRun {
    validateTimestamp(input.completedAt, "Completed at");
    validateId(input.errorCode, "Error code");
    const result = this.database.prepare(`
      UPDATE scan_runs
      SET state = 'failed', completed_at = ?, error_code = ?
      WHERE id = ? AND state = 'running'
    `).run(input.completedAt, input.errorCode, input.runId);
    if (result.changes !== 1) throw invalidTransition(input.runId, "failed");
    return this.requireRun(input.runId);
  }

  public rejectQueued(runId: string, completedAt: string, errorCode: string): ScanRun {
    validateTimestamp(completedAt, "Completed at");
    validateId(errorCode, "Error code");
    const result = this.database.prepare(`
      UPDATE scan_runs
      SET state = 'failed', started_at = ?, completed_at = ?, error_code = ?
      WHERE id = ? AND state = 'queued'
    `).run(completedAt, completedAt, errorCode, runId);
    if (result.changes !== 1) throw invalidTransition(runId, "failed");
    return this.requireRun(runId);
  }

  public requeueInterrupted(): number {
    this.database.prepare(`UPDATE scan_runs SET mode = 'deep' WHERE state = 'queued' AND EXISTS (SELECT 1 FROM scan_runs running WHERE running.search_id = scan_runs.search_id AND running.state = 'running' AND running.mode = 'deep')`).run();
    const superseded = this.database.prepare(`
      UPDATE scan_runs
      SET state = 'failed', completed_at = requested_at, error_code = 'INTERRUPTED'
      WHERE state = 'running'
        AND EXISTS (
          SELECT 1 FROM scan_runs queued
          WHERE queued.search_id = scan_runs.search_id AND queued.state = 'queued'
        )
    `).run().changes;
    const requeued = this.database.prepare(`
      UPDATE scan_runs
      SET state = 'queued', started_at = NULL, completed_at = NULL,
          cards_seen = 0, new_candidates = 0, error_code = NULL
      WHERE state = 'running'
    `).run().changes;
    return Number(superseded) + Number(requeued);
  }

  public requeueRunning(runId: string): ScanRun {
    const result = this.database.prepare(`
      UPDATE scan_runs
      SET state = 'queued', started_at = NULL, completed_at = NULL, error_code = NULL
      WHERE id = ? AND state = 'running'
    `).run(runId);
    if (result.changes !== 1) throw invalidTransition(runId, "queued");
    return this.requireRun(runId);
  }

  public hasSucceeded(searchId: string): boolean {
    return this.database.prepare(`
      SELECT 1 FROM scan_runs WHERE search_id = ? AND state = 'succeeded' LIMIT 1
    `).get(searchId) !== undefined;
  }

  public get(runId: string): ScanRun | undefined {
    const row = this.database.prepare(`SELECT ${RUN_COLUMNS} FROM scan_runs WHERE id = ?`)
      .get(runId) as unknown as ScanRunRow | undefined;
    return row === undefined ? undefined : mapRun(row);
  }

  public getSchedule(searchId: string): ScanSchedule | undefined {
    const row = this.database.prepare(`
      SELECT search_id, last_scan_at, next_scan_at, consecutive_failures, updated_at
      FROM scan_schedules WHERE search_id = ?
    `).get(searchId) as unknown as ScanScheduleRow | undefined;
    return row === undefined ? undefined : mapSchedule(row);
  }

  public listDue(at: string): ScanSchedule[] {
    validateTimestamp(at, "Due time");
    return (this.database.prepare(`
      SELECT search_id, last_scan_at, next_scan_at, consecutive_failures, updated_at
      FROM scan_schedules
      WHERE next_scan_at IS NOT NULL AND next_scan_at <= ?
      ORDER BY next_scan_at ASC, search_id ASC
    `).all(at) as unknown as ScanScheduleRow[]).map(mapSchedule);
  }

  public nextScheduledAt(): string | null {
    const row = this.database.prepare(`
      SELECT min(next_scan_at) AS next_scan_at
      FROM scan_schedules WHERE next_scan_at IS NOT NULL
    `).get() as unknown as { next_scan_at: string | null };
    return row.next_scan_at;
  }

  public recordSchedule(
    searchId: string,
    lastScanAt: string,
    nextScanAt: string,
    consecutiveFailures: number
  ): ScanSchedule {
    validateTimestamp(lastScanAt, "Last scan at");
    validateTimestamp(nextScanAt, "Next scan at");
    validateCount(consecutiveFailures, "Consecutive failures");
    this.database.prepare(`
      INSERT INTO scan_schedules (
        search_id, last_scan_at, next_scan_at, consecutive_failures, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(search_id) DO UPDATE SET
        last_scan_at = excluded.last_scan_at,
        next_scan_at = excluded.next_scan_at,
        consecutive_failures = excluded.consecutive_failures,
        updated_at = excluded.updated_at
    `).run(searchId, lastScanAt, nextScanAt, consecutiveFailures, lastScanAt);
    return this.getSchedule(searchId) as ScanSchedule;
  }

  public pauseSchedule(searchId: string, lastScanAt: string): ScanSchedule {
    validateTimestamp(lastScanAt, "Last scan at");
    this.database.prepare(`
      INSERT INTO scan_schedules (
        search_id, last_scan_at, next_scan_at, consecutive_failures, updated_at
      ) VALUES (?, ?, NULL, 0, ?)
      ON CONFLICT(search_id) DO UPDATE SET
        last_scan_at = excluded.last_scan_at,
        next_scan_at = NULL,
        updated_at = excluded.updated_at
    `).run(searchId, lastScanAt, lastScanAt);
    return this.getSchedule(searchId) as ScanSchedule;
  }

  private requireRun(runId: string): ScanRun {
    const run = this.get(runId);
    if (run === undefined) throw new Error(`Scan run not found: ${runId}`);
    return run;
  }
}

const RUN_COLUMNS = `
  id, search_id, trigger, state, requested_at, started_at, completed_at,
  cards_seen, new_candidates, error_code, mode, stop_reason
`;

function mapRun(row: ScanRunRow): ScanRun {
  return {
    id: row.id,
    mode: row.mode,
    stopReason: row.stop_reason,
    searchId: row.search_id,
    trigger: row.trigger,
    state: row.state,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cardsSeen: row.cards_seen,
    newCandidates: row.new_candidates,
    errorCode: row.error_code
  };
}

function mapSchedule(row: ScanScheduleRow): ScanSchedule {
  return {
    searchId: row.search_id,
    lastScanAt: row.last_scan_at,
    nextScanAt: row.next_scan_at,
    consecutiveFailures: row.consecutive_failures,
    updatedAt: row.updated_at
  };
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function validateId(value: string, label: string): void {
  if (value.length === 0 || value.length > 100) throw new Error(`${label} must contain 1-100 characters`);
}

function validateCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function invalidTransition(runId: string, state: string): Error {
  return new Error(`Scan run ${runId} cannot transition to ${state}`);
}
