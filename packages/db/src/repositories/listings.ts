import type { DatabaseSync } from "node:sqlite";

import {
  assessPriceChange,
  createListingLifecycle,
  expireListing,
  missListing,
  observeListing,
  sellListing,
  type ListingAvailability,
  type ListingDiscoveryKind,
  type ListingEngagement,
  type ListingLifecycleState,
  type SoldReason
} from "@dealfinder/domain";

interface ListingRow {
  id: number;
  raw_candidate_id: number;
  source: "facebook";
  source_listing_id: string;
  listing_url: string;
  title: string;
  displayed_price: string | null;
  current_price_cents: number | null;
  discovery_kind: ListingDiscoveryKind;
  availability: ListingAvailability;
  consecutive_misses: number;
  first_seen_at: string;
  last_seen_at: string;
  possibly_unavailable_at: string | null;
  inactive_at: string | null;
  sold_at: string | null;
  sold_reason: SoldReason | null;
  created_at: string;
  updated_at: string;
}

interface PriceRow {
  id: number;
  listing_id: number;
  observed_at: string;
  price_cents: number;
  displayed_price: string;
  previous_price_cents: number | null;
}

interface EventRow {
  id: number;
  listing_id: number;
  event_key: string;
  type: ListingEvent["type"];
  occurred_at: string;
  meaningful: number;
  alertable: number;
  previous_price_cents: number | null;
  price_cents: number | null;
}

export interface Listing extends ListingLifecycleState {
  id: number;
  rawCandidateId: number;
  source: "facebook";
  sourceListingId: string;
  listingUrl: string;
  title: string;
  displayedPrice: string | null;
  currentPriceCents: number | null;
  discoveryKind: ListingDiscoveryKind;
  createdAt: string;
  updatedAt: string;
}

export interface ListingPricePoint {
  id: number;
  listingId: number;
  observedAt: string;
  priceCents: number;
  displayedPrice: string;
  previousPriceCents: number | null;
}

export interface ListingEvent {
  id: number;
  listingId: number;
  eventKey: string;
  type: "new_listing" | "price_changed";
  occurredAt: string;
  meaningful: boolean;
  alertable: boolean;
  previousPriceCents: number | null;
  priceCents: number | null;
}

export interface IngestListingObservation {
  rawCandidateId: number;
  searchId: string;
  observedAt: string;
  initialScan: boolean;
  source: "facebook";
  sourceListingId: string;
  listingUrl: string;
  title: string;
  displayedPrice: string | null;
  priceCents: number | null;
  engagement?: ListingEngagement;
  explicitlySold?: boolean;
}

export interface IngestedListingObservation {
  listing: Listing;
  created: boolean;
  priceChanged: boolean;
  event: ListingEvent | null;
}

export class ListingsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  /** Claims the scan timestamp. A false result means the complete scan was already ingested. */
  public claimScan(
    searchId: string,
    observedAt: string,
    initialScan: boolean,
    completeSnapshot: boolean
  ): boolean {
    validateText(searchId, "Search ID", 100);
    validateTimestamp(observedAt, "Observed at");
    return this.database.prepare(`
      INSERT INTO listing_scan_ingestions (
        search_id, observed_at, initial_scan, complete_snapshot
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(search_id, observed_at) DO NOTHING
    `).run(searchId, observedAt, numberBoolean(initialScan), numberBoolean(completeSnapshot)).changes === 1;
  }

  public ingestObservation(input: IngestListingObservation): IngestedListingObservation {
    validateObservation(input);
    const existing = this.getBySource(input.source, input.sourceListingId);
    if (existing === undefined) return this.createFromObservation(input);

    let lifecycle = observeListing(existing, input.observedAt);
    if (input.explicitlySold === true && lifecycle.availability !== "sold") {
      lifecycle = sellListing(lifecycle, input.observedAt, "explicit");
    }
    const chronological = Date.parse(input.observedAt) >= Date.parse(existing.lastSeenAt);
    const priceChanged = chronological && input.priceCents !== null &&
      existing.currentPriceCents !== null && input.priceCents !== existing.currentPriceCents;
    let event: ListingEvent | null = null;

    if (priceChanged) {
      const assessment = assessPriceChange(
        existing.currentPriceCents as number,
        input.priceCents as number,
        input.engagement
      );
      this.database.prepare(`
        INSERT INTO listing_price_history (
          listing_id, observed_at, price_cents, displayed_price, previous_price_cents
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(listing_id, observed_at) DO NOTHING
      `).run(
        existing.id,
        input.observedAt,
        input.priceCents,
        input.displayedPrice as string,
        existing.currentPriceCents
      );
      this.database.prepare(`
        INSERT INTO listing_events (
          listing_id, event_key, type, occurred_at, meaningful, alertable,
          previous_price_cents, price_cents
        ) VALUES (?, ?, 'price_changed', ?, ?, ?, ?, ?)
        ON CONFLICT(event_key) DO NOTHING
      `).run(
        existing.id,
        `price:${existing.id}:${input.observedAt}`,
        input.observedAt,
        numberBoolean(assessment.meaningful),
        numberBoolean(assessment.alertable),
        existing.currentPriceCents,
        input.priceCents
      );
    } else if (
      chronological && input.priceCents !== null && existing.currentPriceCents === null
    ) {
      this.database.prepare(`
        INSERT INTO listing_price_history (
          listing_id, observed_at, price_cents, displayed_price, previous_price_cents
        ) VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(listing_id, observed_at) DO NOTHING
      `).run(existing.id, input.observedAt, input.priceCents, input.displayedPrice as string);
    }

    this.database.prepare(`
      UPDATE listings SET
        listing_url = ?, title = ?, displayed_price = ?, current_price_cents = ?,
        availability = ?, consecutive_misses = ?, first_seen_at = ?, last_seen_at = ?,
        possibly_unavailable_at = ?, inactive_at = ?, sold_at = ?, sold_reason = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.listingUrl,
      chronological ? input.title : existing.title,
      chronological ? input.displayedPrice : existing.displayedPrice,
      chronological ? (input.priceCents ?? existing.currentPriceCents) : existing.currentPriceCents,
      lifecycle.availability,
      lifecycle.consecutiveMisses,
      lifecycle.firstSeenAt,
      lifecycle.lastSeenAt,
      lifecycle.possiblyUnavailableAt,
      lifecycle.inactiveAt,
      lifecycle.soldAt,
      lifecycle.soldReason,
      later(existing.updatedAt, input.observedAt),
      existing.id
    );
    this.saveSearchSighting(existing.id, input.searchId, input.observedAt);
    if (priceChanged) event = this.getEvent(`price:${existing.id}:${input.observedAt}`) ?? null;
    return {
      listing: this.require(existing.id),
      created: false,
      priceChanged,
      event
    };
  }

  public recordMisses(
    searchId: string,
    observedListingIds: ReadonlySet<number>,
    missedAt: string
  ): Listing[] {
    validateTimestamp(missedAt, "Missed at");
    const rows = this.database.prepare(`
      SELECT ${LISTING_COLUMNS}
      FROM listings
      INNER JOIN listing_searches ON listing_searches.listing_id = listings.id
      WHERE listing_searches.search_id = ?
      ORDER BY listings.id ASC
    `).all(searchId) as unknown as ListingRow[];
    const changed: Listing[] = [];
    for (const row of rows) {
      if (observedListingIds.has(row.id)) continue;
      const before = mapListing(row);
      const after = expireListing(missListing(before, missedAt), missedAt);
      if (after === before) continue;
      this.saveLifecycle(row.id, after, missedAt);
      changed.push(this.require(row.id));
    }
    return changed;
  }

  public expireInactive(evaluatedAt: string): Listing[] {
    validateTimestamp(evaluatedAt, "Evaluated at");
    const rows = this.database.prepare(`
      SELECT ${LISTING_COLUMNS} FROM listings
      WHERE availability IN ('active', 'possibly_unavailable')
      ORDER BY id ASC
    `).all() as unknown as ListingRow[];
    const expired: Listing[] = [];
    for (const row of rows) {
      const before = mapListing(row);
      const after = expireListing(before, evaluatedAt);
      if (after.availability === before.availability) continue;
      this.saveLifecycle(row.id, after, evaluatedAt);
      expired.push(this.require(row.id));
    }
    return expired;
  }

  public markSold(listingId: number, soldAt: string, reason: SoldReason): Listing {
    const listing = this.require(listingId);
    this.saveLifecycle(listingId, sellListing(listing, soldAt, reason), soldAt);
    return this.require(listingId);
  }

  public get(listingId: number): Listing | undefined {
    const row = this.database.prepare(`SELECT ${LISTING_COLUMNS} FROM listings WHERE id = ?`)
      .get(listingId) as unknown as ListingRow | undefined;
    return row === undefined ? undefined : mapListing(row);
  }

  public getBySource(source: "facebook", sourceListingId: string): Listing | undefined {
    const row = this.database.prepare(`
      SELECT ${LISTING_COLUMNS} FROM listings WHERE source = ? AND source_listing_id = ?
    `).get(source, sourceListingId) as unknown as ListingRow | undefined;
    return row === undefined ? undefined : mapListing(row);
  }

  public listPriceHistory(listingId: number): ListingPricePoint[] {
    return (this.database.prepare(`
      SELECT id, listing_id, observed_at, price_cents, displayed_price, previous_price_cents
      FROM listing_price_history WHERE listing_id = ? ORDER BY observed_at ASC, id ASC
    `).all(listingId) as unknown as PriceRow[]).map(mapPrice);
  }

  public listEvents(listingId: number): ListingEvent[] {
    return (this.database.prepare(`
      SELECT id, listing_id, event_key, type, occurred_at, meaningful, alertable,
             previous_price_cents, price_cents
      FROM listing_events WHERE listing_id = ? ORDER BY occurred_at ASC, id ASC
    `).all(listingId) as unknown as EventRow[]).map(mapEvent);
  }

  public listSearchIds(listingId: number): string[] {
    return (this.database.prepare(`
      SELECT search_id FROM listing_searches WHERE listing_id = ? ORDER BY search_id ASC
    `).all(listingId) as unknown as Array<{ search_id: string }>).map((row) => row.search_id);
  }

  private createFromObservation(input: IngestListingObservation): IngestedListingObservation {
    const lifecycle = createListingLifecycle(input.observedAt, input.explicitlySold);
    const discoveryKind: ListingDiscoveryKind = input.initialScan ? "initial_backlog" : "monitoring";
    const insert = this.database.prepare(`
      INSERT INTO listings (
        raw_candidate_id, source, source_listing_id, listing_url, title, displayed_price,
        current_price_cents, discovery_kind, availability, consecutive_misses,
        first_seen_at, last_seen_at, possibly_unavailable_at, inactive_at,
        sold_at, sold_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.rawCandidateId,
      input.source,
      input.sourceListingId,
      input.listingUrl,
      input.title,
      input.displayedPrice,
      input.priceCents,
      discoveryKind,
      lifecycle.availability,
      lifecycle.consecutiveMisses,
      lifecycle.firstSeenAt,
      lifecycle.lastSeenAt,
      lifecycle.possiblyUnavailableAt,
      lifecycle.inactiveAt,
      lifecycle.soldAt,
      lifecycle.soldReason,
      input.observedAt,
      input.observedAt
    );
    const listingId = Number(insert.lastInsertRowid);
    this.saveSearchSighting(listingId, input.searchId, input.observedAt);
    if (input.priceCents !== null) {
      this.database.prepare(`
        INSERT INTO listing_price_history (
          listing_id, observed_at, price_cents, displayed_price, previous_price_cents
        ) VALUES (?, ?, ?, ?, NULL)
      `).run(listingId, input.observedAt, input.priceCents, input.displayedPrice as string);
    }
    const alertable = discoveryKind === "monitoring";
    this.database.prepare(`
      INSERT INTO listing_events (
        listing_id, event_key, type, occurred_at, meaningful, alertable,
        previous_price_cents, price_cents
      ) VALUES (?, ?, 'new_listing', ?, 1, ?, NULL, ?)
    `).run(
      listingId,
      `new:${listingId}`,
      input.observedAt,
      numberBoolean(alertable),
      input.priceCents
    );
    return {
      listing: this.require(listingId),
      created: true,
      priceChanged: false,
      event: this.getEvent(`new:${listingId}`) ?? null
    };
  }

  private saveSearchSighting(listingId: number, searchId: string, observedAt: string): void {
    this.database.prepare(`
      INSERT INTO listing_searches (listing_id, search_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(listing_id, search_id) DO UPDATE SET
        first_seen_at = min(listing_searches.first_seen_at, excluded.first_seen_at),
        last_seen_at = max(listing_searches.last_seen_at, excluded.last_seen_at)
    `).run(listingId, searchId, observedAt, observedAt);
  }

  private saveLifecycle(listingId: number, state: ListingLifecycleState, updatedAt: string): void {
    this.database.prepare(`
      UPDATE listings SET
        availability = ?, consecutive_misses = ?, first_seen_at = ?, last_seen_at = ?,
        possibly_unavailable_at = ?, inactive_at = ?, sold_at = ?, sold_reason = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      state.availability,
      state.consecutiveMisses,
      state.firstSeenAt,
      state.lastSeenAt,
      state.possiblyUnavailableAt,
      state.inactiveAt,
      state.soldAt,
      state.soldReason,
      updatedAt,
      listingId
    );
  }

  private getEvent(eventKey: string): ListingEvent | undefined {
    const row = this.database.prepare(`
      SELECT id, listing_id, event_key, type, occurred_at, meaningful, alertable,
             previous_price_cents, price_cents
      FROM listing_events WHERE event_key = ?
    `).get(eventKey) as unknown as EventRow | undefined;
    return row === undefined ? undefined : mapEvent(row);
  }

  private require(listingId: number): Listing {
    const listing = this.get(listingId);
    if (listing === undefined) throw new Error(`Listing not found: ${listingId}`);
    return listing;
  }
}

const LISTING_COLUMNS = `
  listings.id, listings.raw_candidate_id, listings.source, listings.source_listing_id,
  listings.listing_url, listings.title, listings.displayed_price, listings.current_price_cents,
  listings.discovery_kind, listings.availability, listings.consecutive_misses,
  listings.first_seen_at, listings.last_seen_at, listings.possibly_unavailable_at,
  listings.inactive_at, listings.sold_at, listings.sold_reason,
  listings.created_at, listings.updated_at
`;

function mapListing(row: ListingRow): Listing {
  return {
    id: row.id,
    rawCandidateId: row.raw_candidate_id,
    source: row.source,
    sourceListingId: row.source_listing_id,
    listingUrl: row.listing_url,
    title: row.title,
    displayedPrice: row.displayed_price,
    currentPriceCents: row.current_price_cents,
    discoveryKind: row.discovery_kind,
    availability: row.availability,
    consecutiveMisses: row.consecutive_misses,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    possiblyUnavailableAt: row.possibly_unavailable_at,
    inactiveAt: row.inactive_at,
    soldAt: row.sold_at,
    soldReason: row.sold_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPrice(row: PriceRow): ListingPricePoint {
  return {
    id: row.id,
    listingId: row.listing_id,
    observedAt: row.observed_at,
    priceCents: row.price_cents,
    displayedPrice: row.displayed_price,
    previousPriceCents: row.previous_price_cents
  };
}

function mapEvent(row: EventRow): ListingEvent {
  return {
    id: row.id,
    listingId: row.listing_id,
    eventKey: row.event_key,
    type: row.type,
    occurredAt: row.occurred_at,
    meaningful: row.meaningful === 1,
    alertable: row.alertable === 1,
    previousPriceCents: row.previous_price_cents,
    priceCents: row.price_cents
  };
}

function validateObservation(input: IngestListingObservation): void {
  if (!Number.isSafeInteger(input.rawCandidateId) || input.rawCandidateId < 1) {
    throw new Error("Raw candidate ID must be a positive integer");
  }
  validateText(input.searchId, "Search ID", 100);
  validateText(input.sourceListingId, "Source listing ID", 100);
  validateText(input.listingUrl, "Listing URL", 4096);
  validateText(input.title, "Title", 1000);
  if (input.displayedPrice !== null) validateText(input.displayedPrice, "Displayed price", 200);
  if (input.priceCents !== null && (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0)) {
    throw new Error("Price must be a non-negative integer number of cents");
  }
  if (input.priceCents !== null && input.displayedPrice === null) {
    throw new Error("A displayed price is required with a parsed price");
  }
  validateTimestamp(input.observedAt, "Observed at");
}

function validateText(value: string, label: string, maximum: number): void {
  if (value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} characters`);
  }
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function numberBoolean(value: boolean): number {
  return value ? 1 : 0;
}

function later(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
