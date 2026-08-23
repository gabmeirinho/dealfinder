import type {
  DatabaseConnection,
  ListingCorrection,
  NormalizationRuleProposal
} from "@dealfinder/db";
import {
  applyFactCorrections,
  assessVehicleRisk,
  evaluateVehicleMatch,
  type FactCorrection,
  type NormalizedFactField,
  type NormalizedVehicleFacts
} from "@dealfinder/domain";

export interface CorrectListingInput extends FactCorrection {
  listingId: number;
  reason?: string | null;
  correctedAt: string;
}

export interface CorrectedListing {
  correction: ListingCorrection;
  facts: NormalizedVehicleFacts;
}

export class CorrectionsService {
  public constructor(private readonly database: () => DatabaseConnection) {}

  public correct(input: CorrectListingInput): CorrectedListing {
    const database = this.database();
    return database.transaction(() => {
      const stored = database.normalizedVehicles.getFacts(input.listingId);
      if (stored === undefined) throw new Error(`Normalized listing not found: ${input.listingId}`);
      const correction = database.corrections.create(
        input.listingId,
        { field: input.field, value: input.value },
        input.reason ?? null,
        input.correctedAt
      );
      const facts = applyFactCorrections(
        stored.facts,
        database.corrections.listForListing(input.listingId)
      );
      this.reassess(database, input.listingId, facts, input.correctedAt);
      database.enrichmentProcessing.enqueue(input.listingId, input.correctedAt);
      for (const searchId of database.listings.listSearchIds(input.listingId)) {
        database.dealScores.delete(input.listingId, searchId);
      }
      return { correction, facts };
    });
  }

  public proposeRule(correctionId: string, proposedAt: string): NormalizationRuleProposal {
    const database = this.database();
    return database.transaction(() => {
      const correction = this.findCorrection(database, correctionId);
      const stored = database.normalizedVehicles.getFacts(correction.listingId);
      if (stored === undefined) throw new Error(`Normalized listing not found: ${correction.listingId}`);
      return database.corrections.proposeRule(
        correctionId,
        factValue(stored.facts, correction.field),
        proposedAt
      );
    });
  }

  public approveRule(proposalId: string, decidedAt: string): NormalizationRuleProposal {
    return this.database().corrections.decideRule(proposalId, "approved", decidedAt);
  }

  public rejectRule(proposalId: string, decidedAt: string): NormalizationRuleProposal {
    return this.database().corrections.decideRule(proposalId, "rejected", decidedAt);
  }

  public effectiveFacts(listingId: number): NormalizedVehicleFacts | undefined {
    const database = this.database();
    const stored = database.normalizedVehicles.getFacts(listingId);
    return stored === undefined
      ? undefined
      : applyFactCorrections(stored.facts, database.corrections.listForListing(listingId));
  }

  private reassess(
    database: DatabaseConnection,
    listingId: number,
    facts: NormalizedVehicleFacts,
    assessedAt: string
  ): void {
    database.normalizedVehicles.saveRisk(listingId, assessVehicleRisk(facts), assessedAt);
    for (const searchId of database.listings.listSearchIds(listingId)) {
      const search = database.searches.get(searchId);
      if (search === undefined) continue;
      database.normalizedVehicles.saveMatch(
        listingId,
        searchId,
        evaluateVehicleMatch(facts, search.criteria),
        assessedAt
      );
    }
  }

  private findCorrection(database: DatabaseConnection, correctionId: string): ListingCorrection {
    const row = database.database.prepare(`
      SELECT listing_id FROM listing_corrections WHERE id = ?
    `).get(correctionId) as unknown as { listing_id: number } | undefined;
    if (row === undefined) throw new Error(`Correction not found: ${correctionId}`);
    const correction = database.corrections.listForListing(row.listing_id)
      .find((candidate) => candidate.id === correctionId);
    if (correction === undefined) throw new Error(`Correction not found: ${correctionId}`);
    return correction;
  }
}

function factValue(
  facts: NormalizedVehicleFacts,
  field: NormalizedFactField
): string | number | null {
  return field === "sellerType" ? facts.seller.type : facts[field];
}
