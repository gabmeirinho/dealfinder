import type {
  FactCorrection,
  NormalizedFactField,
  NormalizedVehicleFacts,
  ReusableNormalizationRule
} from "./types.js";

export function applyFactCorrections(
  facts: NormalizedVehicleFacts,
  corrections: readonly FactCorrection[]
): NormalizedVehicleFacts {
  let corrected = structuredClone(facts);
  for (const correction of corrections) corrected = applyCorrection(corrected, correction);
  return corrected;
}

export function applyReusableRules(
  facts: NormalizedVehicleFacts,
  rules: readonly ReusableNormalizationRule[]
): NormalizedVehicleFacts {
  const corrections = rules
    .filter((rule) => currentValue(facts, rule.field) === rule.sourceValue)
    .map(({ field, value }) => ({ field, value }));
  return applyFactCorrections(facts, corrections);
}

export function validateFactCorrection(correction: FactCorrection): void {
  const numericFields: readonly NormalizedFactField[] = ["priceCents", "year", "mileageKm", "powerHp"];
  const stringFields: readonly NormalizedFactField[] = ["make", "model", "variant"];
  if (numericFields.includes(correction.field)) {
    if (correction.value !== null && (typeof correction.value !== "number" ||
      !Number.isSafeInteger(correction.value) || correction.value < 0)) {
      throw new Error(`${correction.field} correction must be a non-negative integer or null`);
    }
    return;
  }
  if (stringFields.includes(correction.field)) {
    if (correction.value !== null && (typeof correction.value !== "string" || correction.value.trim() === "")) {
      throw new Error(`${correction.field} correction must be a non-empty string or null`);
    }
    return;
  }
  const allowed = correction.field === "fuel"
    ? ["petrol", "diesel", "hybrid", "plug_in_hybrid", "electric", "lpg", "other"]
    : correction.field === "transmission"
      ? ["manual", "automatic"]
      : ["private", "dealer"];
  if (correction.value !== null && !allowed.includes(String(correction.value))) {
    throw new Error(`${correction.field} correction is invalid`);
  }
}

function applyCorrection(facts: NormalizedVehicleFacts, correction: FactCorrection): NormalizedVehicleFacts {
  validateFactCorrection(correction);
  if (correction.field === "sellerType") {
    return { ...facts, seller: { ...facts.seller, type: correction.value as "private" | "dealer" | null } };
  }
  return { ...facts, [correction.field]: correction.value } as NormalizedVehicleFacts;
}

function currentValue(facts: NormalizedVehicleFacts, field: NormalizedFactField): string | number | null {
  return field === "sellerType" ? facts.seller.type : facts[field];
}
