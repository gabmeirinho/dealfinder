export type ListingSubject =
  | "whole_vehicle"
  | "part_or_accessory"
  | "collectible"
  | "printed_material"
  | "unknown";

export type VehicleCondition = "parts_only" | "unknown";

export type ListingClassificationDecision = "continue" | "exclude";

export type ListingPatternCategory =
  | "collectible"
  | "part"
  | "body_or_light"
  | "mechanical_or_electrical"
  | "printed_material"
  | "parts_only";

export interface MatchedListingPattern {
  category: ListingPatternCategory;
  pattern: string;
}

export interface ListingClassification {
  version: number;
  subject: ListingSubject;
  condition: VehicleCondition;
  decision: ListingClassificationDecision;
  matchedPatterns: readonly MatchedListingPattern[];
}

export interface ClassifyListingInput {
  /**
   * Only the title is used by the deterministic classifier. Descriptions often
   * mention parts that were repaired or replaced on an otherwise valid car.
   */
  title: string;
}
