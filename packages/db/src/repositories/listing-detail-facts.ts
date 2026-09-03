import type { DatabaseSync } from "node:sqlite";
import type { FuelType, TransmissionType } from "@dealfinder/domain";

export interface ListingDetailStructuredFacts {
  year: number | null;
  mileageKm: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  fuel: FuelType | null;
  transmission: TransmissionType | null;
  powerHp: number | null;
  condition: string | null;
  listingCondition: string | null;
}

export interface ListingDetailFactValues {
  year: number | null;
  mileageKm: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  fuel: FuelType | null;
  transmission: TransmissionType | null;
  powerHp: number | null;
  /** Odometer found in the result card, kept separate from detail description text. */
  cardMileageKm?: number | null;
}

export type ListingDetailFactSource = "facebook_structured" | "description" | "card" | "none";

export interface ListingDetailMileageSources {
  structuredKm: number | null;
  descriptionKm: number | null;
  cardKm: number | null;
  selectedKm: number | null;
  source: ListingDetailFactSource;
  conflict: boolean;
}

export interface ListingDetailFactSnapshot {
  listingId: number;
  structuredFacts: ListingDetailStructuredFacts;
  textFacts: ListingDetailFactValues;
  selectedFacts: ListingDetailFactValues;
  mileage: ListingDetailMileageSources;
  conflicts: readonly string[];
  capturedAt: string;
}

interface FactRow {
  listing_id: number;
  structured_facts_json: string;
  text_facts_json: string;
  selected_facts_json: string;
  conflicts_json: string;
  captured_at: string;
}

const FACT_FIELDS = [
  "year", "mileageKm", "make", "model", "variant", "fuel", "transmission", "powerHp"
] as const;

export class ListingDetailFactsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public save(
    listingId: number,
    structuredFacts: ListingDetailStructuredFacts,
    textFacts: ListingDetailFactValues,
    selectedFacts: ListingDetailFactValues,
    capturedAt: string
  ): ListingDetailFactSnapshot {
    if (!Number.isSafeInteger(listingId) || listingId < 1) throw new Error("Listing ID must be positive");
    timestamp(capturedAt);
    validateFacts(structuredFacts, "Structured facts");
    validateFacts(textFacts, "Text facts");
    validateFacts(selectedFacts, "Selected facts");
    const conflicts = FACT_FIELDS.filter((field) =>
      structuredFacts[field] !== null && textFacts[field] !== null &&
      !sameFact(structuredFacts[field], textFacts[field])
    );
    if (structuredFacts.mileageKm !== null && textFacts.cardMileageKm !== undefined &&
        textFacts.cardMileageKm !== null && structuredFacts.mileageKm !== textFacts.cardMileageKm &&
        !conflicts.includes("mileageKm")) {
      conflicts.push("mileageKm");
    }
    this.database.prepare(`
      INSERT INTO listing_detail_facts (
        listing_id, structured_facts_json, text_facts_json,
        selected_facts_json, conflicts_json, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id) DO UPDATE SET
        structured_facts_json = excluded.structured_facts_json,
        text_facts_json = excluded.text_facts_json,
        selected_facts_json = excluded.selected_facts_json,
        conflicts_json = excluded.conflicts_json,
        captured_at = excluded.captured_at
    `).run(
      listingId,
      JSON.stringify(structuredFacts),
      JSON.stringify(textFacts),
      JSON.stringify(selectedFacts),
      JSON.stringify(conflicts),
      capturedAt
    );
    return this.get(listingId) as ListingDetailFactSnapshot;
  }

  public get(listingId: number): ListingDetailFactSnapshot | undefined {
    const row = this.database.prepare(`
      SELECT listing_id, structured_facts_json, text_facts_json,
             selected_facts_json, conflicts_json, captured_at
      FROM listing_detail_facts WHERE listing_id = ?
    `).get(listingId) as unknown as FactRow | undefined;
    if (row === undefined) return undefined;
    const structuredFacts = parseObject<ListingDetailStructuredFacts>(row.structured_facts_json, "structured facts");
    const textFacts = parseObject<ListingDetailFactValues>(row.text_facts_json, "text facts");
    const selectedFacts = parseObject<ListingDetailFactValues>(row.selected_facts_json, "selected facts");
    const conflicts = parseArray(row.conflicts_json, "fact conflicts");
    validateFacts(structuredFacts, "Stored structured facts");
    validateFacts(textFacts, "Stored text facts");
    validateFacts(selectedFacts, "Stored selected facts");
    if (!conflicts.every((value) => typeof value === "string" && FACT_FIELDS.includes(value as typeof FACT_FIELDS[number]))) {
      throw new Error("Stored fact conflicts are invalid");
    }
    const structuredKm = structuredFacts.mileageKm;
    const descriptionKm = textFacts.mileageKm;
    const cardKm = textFacts.cardMileageKm ?? null;
    const selectedKm = selectedFacts.mileageKm;
    return {
      listingId: row.listing_id,
      structuredFacts,
      textFacts,
      selectedFacts,
      mileage: {
        structuredKm,
        descriptionKm,
        cardKm,
        selectedKm,
        source: structuredKm !== null ? "facebook_structured" :
          descriptionKm !== null ? "description" : cardKm !== null ? "card" : "none",
        conflict: conflicts.includes("mileageKm")
      },
      conflicts,
      capturedAt: row.captured_at
    };
  }
}

function validateFacts(value: ListingDetailStructuredFacts | ListingDetailFactValues, label: string): void {
  for (const field of FACT_FIELDS) {
    const fact = value[field];
    if (fact !== null && fact !== undefined && typeof fact !== "string" && typeof fact !== "number") {
      throw new Error(`${label}.${field} is invalid`);
    }
  }
}

function sameFact(left: string | number | null, right: string | number | null): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return left.trim().toLocaleLowerCase("en") === right.trim().toLocaleLowerCase("en");
  }
  return left === right;
}

function parseObject<T>(json: string, label: string): T & Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Stored ${label} are invalid`);
  }
  return value as T & Record<string, unknown>;
}

function parseArray(json: string, label: string): string[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Stored ${label} are invalid`);
  }
  return value;
}

function timestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Captured at must be a valid ISO timestamp");
}
