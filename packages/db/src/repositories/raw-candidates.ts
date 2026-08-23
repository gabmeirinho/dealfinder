import type { DatabaseSync } from "node:sqlite";

import { withTransaction } from "../transactions.js";

interface CandidateRow {
  id: number;
  source: "facebook";
  source_listing_id: string;
  listing_url: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface ObservationRow {
  id: number;
  candidate_id: number;
  search_id: string;
  observed_at: string;
  title: string;
  displayed_price: string | null;
  location: string | null;
  thumbnail_url: string | null;
  raw_card_facts_json: string;
}

export interface RawCandidate {
  id: number;
  source: "facebook";
  sourceListingId: string;
  listingUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface RawCandidateObservation {
  id: number;
  candidateId: number;
  searchId: string;
  observedAt: string;
  title: string;
  displayedPrice: string | null;
  location: string | null;
  thumbnailUrl: string | null;
  rawCardFacts: readonly string[];
}

export interface SaveRawCandidateObservation {
  searchId: string;
  observedAt: string;
  candidate: {
    source: "facebook";
    sourceListingId: string;
    url: string;
    title: string;
    displayedPrice: string | null;
    location: string | null;
    thumbnailUrl: string | null;
    rawCardFacts: readonly string[];
  };
}

export interface SavedRawCandidateObservation {
  candidate: RawCandidate;
  observation: RawCandidateObservation;
  inserted: boolean;
}

export class RawCandidatesRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public saveObservation(input: SaveRawCandidateObservation): SavedRawCandidateObservation {
    validateInput(input);
    return withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO raw_candidates (
          source, source_listing_id, listing_url, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source, source_listing_id) DO UPDATE SET
          listing_url = excluded.listing_url,
          first_seen_at = min(raw_candidates.first_seen_at, excluded.first_seen_at),
          last_seen_at = max(raw_candidates.last_seen_at, excluded.last_seen_at)
      `).run(
        input.candidate.source,
        input.candidate.sourceListingId,
        input.candidate.url,
        input.observedAt,
        input.observedAt
      );

      const candidateRow = this.database.prepare(`
        SELECT id, source, source_listing_id, listing_url, first_seen_at, last_seen_at
        FROM raw_candidates
        WHERE source = ? AND source_listing_id = ?
      `).get(input.candidate.source, input.candidate.sourceListingId) as unknown as CandidateRow;

      const insert = this.database.prepare(`
        INSERT INTO raw_candidate_observations (
          candidate_id, search_id, observed_at, title, displayed_price,
          location, thumbnail_url, raw_card_facts_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(candidate_id, search_id, observed_at) DO NOTHING
      `).run(
        candidateRow.id,
        input.searchId,
        input.observedAt,
        input.candidate.title,
        input.candidate.displayedPrice,
        input.candidate.location,
        input.candidate.thumbnailUrl,
        JSON.stringify(input.candidate.rawCardFacts)
      );

      const observationRow = this.database.prepare(`
        SELECT id, candidate_id, search_id, observed_at, title, displayed_price,
               location, thumbnail_url, raw_card_facts_json
        FROM raw_candidate_observations
        WHERE candidate_id = ? AND search_id = ? AND observed_at = ?
      `).get(candidateRow.id, input.searchId, input.observedAt) as unknown as ObservationRow;

      return {
        candidate: mapCandidate(candidateRow),
        observation: mapObservation(observationRow),
        inserted: insert.changes === 1
      };
    });
  }

  public get(source: "facebook", sourceListingId: string): RawCandidate | undefined {
    const row = this.database.prepare(`
      SELECT id, source, source_listing_id, listing_url, first_seen_at, last_seen_at
      FROM raw_candidates
      WHERE source = ? AND source_listing_id = ?
    `).get(source, sourceListingId) as unknown as CandidateRow | undefined;
    return row === undefined ? undefined : mapCandidate(row);
  }

  public listObservations(candidateId: number): RawCandidateObservation[] {
    return (this.database.prepare(`
      SELECT id, candidate_id, search_id, observed_at, title, displayed_price,
             location, thumbnail_url, raw_card_facts_json
      FROM raw_candidate_observations
      WHERE candidate_id = ?
      ORDER BY observed_at ASC, id ASC
    `).all(candidateId) as unknown as ObservationRow[]).map(mapObservation);
  }
}

function mapCandidate(row: CandidateRow): RawCandidate {
  return {
    id: row.id,
    source: row.source,
    sourceListingId: row.source_listing_id,
    listingUrl: row.listing_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at
  };
}

function mapObservation(row: ObservationRow): RawCandidateObservation {
  const facts: unknown = JSON.parse(row.raw_card_facts_json);
  if (!Array.isArray(facts) || !facts.every((fact) => typeof fact === "string")) {
    throw new Error(`Raw observation ${row.id} contains invalid card facts`);
  }
  return {
    id: row.id,
    candidateId: row.candidate_id,
    searchId: row.search_id,
    observedAt: row.observed_at,
    title: row.title,
    displayedPrice: row.displayed_price,
    location: row.location,
    thumbnailUrl: row.thumbnail_url,
    rawCardFacts: facts
  };
}

function validateInput(input: SaveRawCandidateObservation): void {
  bounded(input.searchId, "Search ID", 100);
  bounded(input.candidate.sourceListingId, "Source listing ID", 100);
  bounded(input.candidate.url, "Listing URL", 4096);
  bounded(input.candidate.title, "Title", 1000);
  optionalBounded(input.candidate.displayedPrice, "Displayed price", 200);
  optionalBounded(input.candidate.location, "Location", 500);
  optionalBounded(input.candidate.thumbnailUrl, "Thumbnail URL", 4096);
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error("Observed at must be an ISO timestamp");
  if (input.candidate.rawCardFacts.some((fact) => fact.trim() === "" || fact.length > 1000)) {
    throw new Error("Raw card facts must contain non-empty strings of at most 1000 characters");
  }
}

function bounded(value: string, label: string, maximum: number): void {
  if (value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} characters`);
  }
}

function optionalBounded(value: string | null, label: string, maximum: number): void {
  if (value !== null) bounded(value, label, maximum);
}
