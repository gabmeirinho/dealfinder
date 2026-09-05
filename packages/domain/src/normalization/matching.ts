import { canonicalMake, identityKey } from "../searches/model-target.js";
import type { SearchConstraint, VehicleSearchCriteria } from "../searches/index.js";
import type { NormalizedVehicleFacts } from "./types.js";

export interface FilterExplanation {
  criterion: keyof VehicleSearchCriteria;
  matched: boolean | null;
  explanation: string;
}

export type VehicleMatchStatus = "matches" | "excluded" | "needs_information";

export interface VehicleMatchEvaluation {
  status: VehicleMatchStatus;
  missingCriteria: readonly FilterExplanation[];
  eligible: boolean;
  hardFailures: readonly FilterExplanation[];
  softContributions: readonly FilterExplanation[];
}

export function evaluateVehicleMatch(
  facts: NormalizedVehicleFacts,
  criteria: VehicleSearchCriteria
): VehicleMatchEvaluation {
  const hardFailures: FilterExplanation[] = [];
  const missingCriteria: FilterExplanation[] = [];
  const softContributions: FilterExplanation[] = [];
  const text = fold([
    facts.original.title,
    facts.original.description,
    ...facts.original.cardFacts
  ].filter((value): value is string => value !== null).join(" "));
  const add = <T>(
    criterion: keyof VehicleSearchCriteria,
    constraint: SearchConstraint<T> | null,
    matched: boolean | null,
    explanation: string
  ) => {
    if (constraint === null) return;
    const item = { criterion, matched, explanation };
    if (constraint.strength === "hard") {
      if (matched === false) hardFailures.push(item);
      else if (matched === null) missingCriteria.push(item);
    } else {
      softContributions.push(item);
    }
  };

  if (criteria.modelTarget != null) {
    const target = criteria.modelTarget.value;
    const make = facts.make === null ? null : identityKey(canonicalMake(facts.make)) === identityKey(canonicalMake(target.make));
    const model = modelMatch(facts.model, facts.variant, target.model);
    const variant = target.variant === null ? true : keywordMatch(facts.variant, [target.variant]);
    const matches = [make, model, variant];
    add("modelTarget", criteria.modelTarget, matches.includes(false) ? false : matches.includes(null) ? null : true,
      `Model target: ${target.make} ${target.model}${target.variant ? ` ${target.variant}` : ""}`);
  }
  add("makeKeywords", criteria.makeKeywords, keywordMatch(facts.make, criteria.makeKeywords?.value),
    explain("make", facts.make));
  add("modelKeywords", criteria.modelKeywords, keywordMatch(
    [facts.model, facts.variant].filter(Boolean).join(" ") || null,
    criteria.modelKeywords?.value
  ), explain("model", facts.model));
  add("variantKeywords", criteria.variantKeywords, keywordMatch(facts.variant, criteria.variantKeywords?.value),
    explain("variant", facts.variant));
  if (criteria.priceRange !== null) {
    const range = criteria.priceRange.value;
    const matched = facts.priceCents === null ? null :
      (range.minimumEur === null || facts.priceCents >= range.minimumEur * 100) &&
      (range.maximumEur === null || facts.priceCents <= range.maximumEur * 100);
    add("priceRange", criteria.priceRange, matched, explain("price", facts.priceCents));
  }
  add("minimumYear", criteria.minimumYear, facts.year === null ? null : facts.year >= (criteria.minimumYear?.value ?? 0),
    explain("year", facts.year));
  add("maximumMileageKm", criteria.maximumMileageKm,
    facts.mileageKm === null ? null : facts.mileageKm <= (criteria.maximumMileageKm?.value ?? 0),
    explain("mileage", facts.mileageKm));
  add("fuels", criteria.fuels, facts.fuel === null ? null : (criteria.fuels?.value.includes(facts.fuel) ?? false),
    explain("fuel", facts.fuel));
  add("transmissions", criteria.transmissions,
    facts.transmission === null ? null : (criteria.transmissions?.value.includes(facts.transmission) ?? false),
    explain("transmission", facts.transmission));
  add("minimumPowerHp", criteria.minimumPowerHp,
    facts.powerHp === null ? null : facts.powerHp >= (criteria.minimumPowerHp?.value ?? 0),
    explain("power", facts.powerHp));
  add("sellerPreference", criteria.sellerPreference,
    facts.seller.type === null ? null : facts.seller.type === criteria.sellerPreference?.value,
    explain("seller type", facts.seller.type));
  add("requiredKeywords", criteria.requiredKeywords,
    criteria.requiredKeywords === null ? null : criteria.requiredKeywords.value.every((keyword) => text.includes(fold(keyword)))
      ? true : facts.original.description === null ? null : false,
    "required keyword check against original listing text");
  add("excludedKeywords", criteria.excludedKeywords,
    criteria.excludedKeywords === null ? null : criteria.excludedKeywords.value.every((keyword) => !text.includes(fold(keyword))),
    "excluded keyword check against original listing text");

  const status: VehicleMatchStatus = hardFailures.length > 0 ? "excluded" :
    missingCriteria.length > 0 ? "needs_information" : "matches";
  return { status, eligible: status === "matches", hardFailures, missingCriteria, softContributions };
}

function keywordMatch(value: string | null, keywords: readonly string[] | undefined): boolean | null {
  if (value === null) return null;
  return keywords?.some((keyword) => fold(value).includes(fold(keyword))) ?? null;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
}

function explain(label: string, value: unknown): string {
  return value === null ? `${label} is unknown` : `${label} normalized as ${String(value)}`;
}

// Title extraction can split a multiword model between model and variant.
// Retain uncertain prefixes for enrichment instead of treating them as mismatches.
function modelMatch(model: string | null, variant: string | null, target: string): boolean | null {
  if (model === null) return null;
  if (identityKey(model) === identityKey(target)) return true;
  const words = (value: string): string => fold(value).replace(/[^a-z0-9]+/g, " ").trim();
  const expected = words(target);
  const known = words(model);
  if (known && expected.startsWith(`${known} `)) {
    if (variant === null) return null;
    const combined = words(`${model} ${variant}`);
    return combined === expected || combined.startsWith(`${expected} `);
  }
  return false;
}
