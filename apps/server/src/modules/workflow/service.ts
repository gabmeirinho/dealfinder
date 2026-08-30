import type {
  DatabaseConnection,
  ListingReviewState,
  NormalizationRuleProposal
} from "@dealfinder/db";
import {
  applyFactCorrections,
  type FactCorrection,
  type NormalizedVehicleFacts
} from "@dealfinder/domain";

import { CorrectionsService } from "../corrections/index.js";

export interface ListingInboxFilters {
  state?: ListingReviewState;
  searchId?: string;
  risk?: boolean;
  archived?: boolean;
  query?: string;
}

export class ListingReviewService {
  private readonly corrections: CorrectionsService;

  public constructor(
    private readonly database: () => DatabaseConnection,
    private readonly processingWake: () => void = () => undefined
  ) {
    this.corrections = new CorrectionsService(database);
  }

  public list(filters: ListingInboxFilters = {}): unknown[] {
    const database = this.database();
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (filters.state !== undefined) {
      conditions.push("reviews.state = ?");
      parameters.push(filters.state);
    }
    conditions.push("reviews.archived = ?");
    parameters.push(filters.archived === true ? 1 : 0);
    if (filters.searchId !== undefined) {
      conditions.push("EXISTS (SELECT 1 FROM listing_searches ls WHERE ls.listing_id = listings.id AND ls.search_id = ?)");
      parameters.push(filters.searchId);
    }
    if (filters.risk === true) conditions.push("risk.high_risk_verify_price = 1");
    if (filters.query !== undefined && filters.query.trim() !== "") {
      conditions.push("(listings.title LIKE ? OR facts.make LIKE ? OR facts.model LIKE ?)");
      const query = `%${filters.query.trim().slice(0, 100).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      parameters.push(query, query, query);
    }
    const rows = database.database.prepare(`
      SELECT listings.id
      FROM listings
      JOIN listing_reviews reviews ON reviews.listing_id = listings.id
      LEFT JOIN normalized_vehicle_facts facts ON facts.listing_id = listings.id
      LEFT JOIN listing_risk_assessments risk ON risk.listing_id = listings.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY COALESCE((SELECT max(total_score) FROM listing_deal_scores scores
                         WHERE scores.listing_id = listings.id), -1) DESC,
               listings.last_seen_at DESC, listings.id DESC
      LIMIT 250
    `).all(...parameters) as unknown as Array<{ id: number }>;
    return rows.map(({ id }) => this.summary(id));
  }

  public detail(listingId: number): Record<string, unknown> | undefined {
    const database = this.database();
    const listing = database.listings.get(listingId);
    const review = database.listingReviews.get(listingId);
    if (listing === undefined || review === undefined) return undefined;
    const stored = database.normalizedVehicles.getFacts(listingId);
    const corrections = database.corrections.listForListing(listingId);
    const effectiveFacts = stored === undefined
      ? undefined
      : applyFactCorrections(stored.facts, corrections);
    const searchIds = database.listings.listSearchIds(listingId);
    const scores = searchIds.flatMap((searchId) => {
      const score = database.dealScores.get(listingId, searchId);
      if (score === undefined) return [];
      return [{ ...score, searchName: database.searches.get(searchId)?.name ?? "Deleted search" }];
    }).sort((left, right) => right.score.total - left.score.total);
    const duplicate = database.duplicates.listGroups().find((group) =>
      group.members.some((member) => member.listingId === listingId)
    );
    const observation = latestObservation(database, listing.rawCandidateId);

    return {
      ...this.summary(listingId),
      original: stored?.facts.original ?? {
        title: plainText(listing.title), description: null, displayedPrice: listing.displayedPrice, cardFacts: []
      },
      normalizedFacts: stored?.facts ?? null,
      effectiveFacts: effectiveFacts ?? null,
      corrections: corrections.map((correction) => ({
        ...correction,
        proposal: database.corrections.getProposalForCorrection(correction.id) ?? null
      })),
      risk: database.normalizedVehicles.getRisk(listingId) ?? null,
      matches: searchIds.map((searchId) => ({
        searchId,
        searchName: database.searches.get(searchId)?.name ?? "Deleted search",
        evaluation: database.normalizedVehicles.getMatch(listingId, searchId) ?? null,
        distance: database.geocoding.getDistance(listingId, searchId) ?? null
      })),
      scores,
      priceHistory: database.listings.listPriceHistory(listingId),
      duplicate: duplicate === undefined ? null : {
        ...duplicate,
        members: duplicate.members.map((member) => ({
          ...member,
          listingUrl: safeFacebookUrl(member.listingUrl)
        }))
      },
      notes: database.listingReviews.listNotes(listingId),
      processing: database.enrichmentProcessing.getQueueItem(listingId) ?? null,
      enrichment: database.enrichmentProcessing.getEnrichment(listingId) ?? null,
      location: observation?.location ?? null,
      sellerMessage: sellerMessage(effectiveFacts, listing.title),
      suggestedQuestions: sellerQuestions(effectiveFacts)
    };
  }

  public changeState(
    listingId: number,
    state: ListingReviewState,
    rejectionReason: string | null,
    changedAt: string
  ): unknown {
    this.database().listingReviews.setState(listingId, state, rejectionReason, changedAt);
    return this.detail(listingId);
  }

  public archive(listingId: number, archived: boolean, changedAt: string): unknown {
    this.database().listingReviews.setArchived(listingId, archived, changedAt);
    return this.detail(listingId);
  }

  public addNote(listingId: number, body: string, createdAt: string): unknown {
    this.database().listingReviews.addNote(listingId, plainText(body), createdAt);
    return this.detail(listingId);
  }

  public markSold(listingId: number, soldAt: string): unknown {
    this.database().listings.markSold(listingId, soldAt, "user");
    return this.detail(listingId);
  }

  public correct(
    listingId: number,
    correction: FactCorrection,
    reason: string | null,
    proposeRule: boolean,
    correctedAt: string
  ): unknown {
    const result = this.corrections.correct({
      listingId,
      ...correction,
      reason: reason === null ? null : plainText(reason),
      correctedAt
    });
    if (proposeRule) this.corrections.proposeRule(result.correction.id, correctedAt);
    this.processingWake();
    return this.detail(listingId);
  }

  public decideRule(proposalId: string, decision: "approved" | "rejected", decidedAt: string): NormalizationRuleProposal {
    return decision === "approved"
      ? this.corrections.approveRule(proposalId, decidedAt)
      : this.corrections.rejectRule(proposalId, decidedAt);
  }

  private summary(listingId: number): Record<string, unknown> {
    const database = this.database();
    const listing = database.listings.get(listingId);
    const review = database.listingReviews.get(listingId);
    if (listing === undefined || review === undefined) throw new Error(`Listing not found: ${listingId}`);
    const stored = database.normalizedVehicles.getFacts(listingId);
    const effective = stored === undefined
      ? null
      : applyFactCorrections(stored.facts, database.corrections.listForListing(listingId));
    const searchIds = database.listings.listSearchIds(listingId);
    const scores = searchIds.map((searchId) => database.dealScores.get(listingId, searchId))
      .filter((score) => score !== undefined);
    const topScore = scores.sort((left, right) => right.score.total - left.score.total)[0] ?? null;
    const observation = latestObservation(database, listing.rawCandidateId);
    return {
      id: listing.id,
      title: plainText(listing.title),
      source: listing.source,
      sourceUrl: safeFacebookUrl(listing.listingUrl),
      displayedPrice: listing.displayedPrice === null ? null : plainText(listing.displayedPrice),
      currentPriceCents: listing.currentPriceCents,
      availability: listing.availability,
      discoveryKind: listing.discoveryKind,
      firstSeenAt: listing.firstSeenAt,
      lastSeenAt: listing.lastSeenAt,
      location: observation?.location === null || observation === undefined ? null : plainText(observation.location),
      review,
      facts: effective,
      risk: database.normalizedVehicles.getRisk(listingId) ?? null,
      score: topScore?.score ?? null,
      processing: database.enrichmentProcessing.getQueueItem(listingId) ?? null
    };
  }
}

function latestObservation(database: DatabaseConnection, rawCandidateId: number) {
  return database.rawCandidates.listObservations(rawCandidateId).at(-1);
}

function plainText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").trim();
}

function safeFacebookUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "facebook.com" || host.endsWith(".facebook.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function sellerMessage(facts: NormalizedVehicleFacts | undefined, fallbackTitle: string): string {
  const vehicle = facts === undefined
    ? plainText(fallbackTitle)
    : [facts.year, facts.make, facts.model, facts.variant].filter(Boolean).join(" ") || plainText(fallbackTitle);
  return `Hello, is the ${vehicle} still available? I am interested and would like to confirm its condition and history before arranging a viewing. Thank you.`;
}

function sellerQuestions(facts: NormalizedVehicleFacts | undefined): string[] {
  const questions = [
    "Is the vehicle still available, and is the advertised price the full purchase price?",
    "Do you have the maintenance history and inspection records?",
    "Has the vehicle had any accidents, structural repairs, or current faults?",
    "Can I inspect and test-drive it before making any commitment?"
  ];
  if (facts?.indicators.imported === true) questions.splice(2, 0, "When was it imported, and is the registration history available?");
  if (facts?.seller.type === "dealer") questions.push("What warranty is included in the advertised price?");
  return questions;
}
