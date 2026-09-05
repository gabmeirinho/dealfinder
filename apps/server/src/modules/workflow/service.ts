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
  sort?: "recent" | "market_value" | "personal_fit" | "confidence";
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
    conditions.push("(classification.decision IS NULL OR classification.decision <> 'exclude')");
    conditions.push(`EXISTS (
      SELECT 1 FROM listing_match_evaluations visible_match
      WHERE visible_match.listing_id = listings.id AND visible_match.match_status <> 'excluded'
    )`);
    if (filters.query !== undefined && filters.query.trim() !== "") {
      conditions.push("(listings.title LIKE ? OR facts.make LIKE ? OR facts.model LIKE ?)");
      const query = `%${filters.query.trim().slice(0, 100).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      parameters.push(query, query, query);
    }
    const order = filters.sort === "market_value" ? "market_discount_percent" :
      filters.sort === "personal_fit" ? "personal_fit_percent" :
      filters.sort === "confidence" ? "CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END" : null;
    const ranking = order === null ? "" :
      `(SELECT MAX(${order}) FROM listing_deal_scores scores WHERE scores.listing_id = listings.id) DESC,`;
    const rows = database.database.prepare(`
      SELECT listings.id
      FROM listings
      JOIN listing_reviews reviews ON reviews.listing_id = listings.id
      LEFT JOIN normalized_vehicle_facts facts ON facts.listing_id = listings.id
      LEFT JOIN listing_risk_assessments risk ON risk.listing_id = listings.id
      LEFT JOIN listing_classifications classification ON classification.listing_id = listings.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${ranking}
               listings.last_seen_at DESC, listings.id DESC
      LIMIT 250
    `).all(...parameters) as unknown as Array<{ id: number }>;
    return rows.map(({ id }) => this.summary(id, filters.sort));
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
    }).sort((left, right) => left.searchName.localeCompare(right.searchName) || left.searchId.localeCompare(right.searchId));
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
      detailFacts: database.listingDetailFacts.get(listingId) ?? null,
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
      classification: database.listingClassifications.get(listingId) ?? null,
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

  private summary(listingId: number, sort: ListingInboxFilters["sort"] = "recent"): Record<string, unknown> {
    const database = this.database();
    const listing = database.listings.get(listingId);
    const review = database.listingReviews.get(listingId);
    if (listing === undefined || review === undefined) throw new Error(`Listing not found: ${listingId}`);
    const stored = database.normalizedVehicles.getFacts(listingId);
    const effective = stored === undefined
      ? null
      : applyFactCorrections(stored.facts, database.corrections.listForListing(listingId));
    const searchIds = database.listings.listSearchIds(listingId);
    const matches = searchIds.map((searchId) => database.normalizedVehicles.getMatch(listingId, searchId));
    const matchStatus = matches.some((match) => match?.status === "matches") ? "matches" :
      matches.some((match) => match?.status === "needs_information") ? "needs_information" : "excluded";
    const scores = searchIds.map((searchId) => database.dealScores.get(listingId, searchId))
      .filter((score) => score !== undefined);
    const value = (stored: typeof scores[number]): number => sort === "market_value"
      ? stored.score.marketValue.discountPercent ?? -Infinity : sort === "personal_fit"
      ? stored.score.personalFit.percent ?? -Infinity : sort === "confidence"
      ? ({ high: 3, medium: 2, low: 1 }[stored.score.confidence.level]) : 0;
    const topScore = scores.sort((left, right) => {
      const difference = value(right) - value(left);
      return (Number.isNaN(difference) ? 0 : difference) || left.searchId.localeCompare(right.searchId);
    })[0] ?? null;
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
      matchStatus,
      assessmentSearchName: topScore === null ? null : database.searches.get(topScore.searchId)?.name ?? null,
      score: matchStatus === "matches" ? topScore?.score ?? null : null,
      processing: database.enrichmentProcessing.getQueueItem(listingId) ?? null,
      classification: database.listingClassifications.get(listingId) ?? null
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
