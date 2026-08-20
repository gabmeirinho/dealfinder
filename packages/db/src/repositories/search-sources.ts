import type { DatabaseSync } from "node:sqlite";

import type { SearchSource } from "@dealfinder/domain";

interface SearchSourceRow {
  search_id: string;
  source: SearchSource;
  source_url: string;
  criteria_fingerprint: string;
  verified_at: string;
  updated_at: string;
}

export interface SearchSourceVerification {
  searchId: string;
  source: SearchSource;
  sourceUrl: string;
  criteriaFingerprint: string;
  verifiedAt: string;
  updatedAt: string;
}

export interface SaveSearchSourceVerification {
  searchId: string;
  source: SearchSource;
  sourceUrl: string;
  criteriaFingerprint: string;
  verifiedAt: string;
}

export class SearchSourcesRepository {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date()
  ) {}

  public get(
    searchId: string,
    source: SearchSource
  ): SearchSourceVerification | undefined {
    validateSearchId(searchId);
    const row = this.database.prepare(`
      SELECT search_id, source, source_url, criteria_fingerprint, verified_at, updated_at
      FROM search_sources
      WHERE search_id = ? AND source = ?
    `).get(searchId, source) as unknown as SearchSourceRow | undefined;
    return row === undefined ? undefined : mapVerification(row);
  }

  public saveVerification(input: SaveSearchSourceVerification): SearchSourceVerification {
    validateSearchId(input.searchId);
    validateUrl(input.sourceUrl);
    validateFingerprint(input.criteriaFingerprint);
    const updatedAt = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO search_sources (
        search_id, source, source_url, criteria_fingerprint, verified_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(search_id, source) DO UPDATE SET
        source_url = excluded.source_url,
        criteria_fingerprint = excluded.criteria_fingerprint,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at
    `).run(
      input.searchId,
      input.source,
      input.sourceUrl,
      input.criteriaFingerprint,
      input.verifiedAt,
      updatedAt
    );

    const persisted = this.get(input.searchId, input.source);
    if (persisted === undefined) {
      throw new Error(`Failed to persist ${input.source} verification for ${input.searchId}`);
    }
    return persisted;
  }
}

function mapVerification(row: SearchSourceRow): SearchSourceVerification {
  return {
    searchId: row.search_id,
    source: row.source,
    sourceUrl: row.source_url,
    criteriaFingerprint: row.criteria_fingerprint,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at
  };
}

function validateSearchId(id: string): void {
  if (id.length === 0 || id.length > 100) {
    throw new Error("Search IDs must contain 1-100 characters");
  }
}

function validateUrl(value: string): void {
  if (value.length === 0 || value.length > 4096) {
    throw new Error("Source URLs must contain 1-4096 characters");
  }
}

function validateFingerprint(value: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Criteria fingerprints must be 64 lowercase hexadecimal characters");
  }
}
