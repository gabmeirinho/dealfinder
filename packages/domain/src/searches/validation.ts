import { DEFAULT_SCAN_LIMITS, type ScanLimits } from "../scanning/types.js";
import { canonicalModelTarget } from "./model-target.js";
import {
  SEARCH_RADIUS_OPTIONS_KM,
  type ConstraintStrength,
  type FuelType,
  type SearchConstraint,
  type SearchRadiusKm,
  type SearchValidationIssue,
  type SearchValidationResult,
  type SellerType,
  type TransmissionType,
  type ValidatedVehicleSearchDraft,
  type VehicleSearchCriteria,
  type VehicleSearchDraft
} from "./types.js";

const STRENGTHS: readonly ConstraintStrength[] = ["hard", "soft"];
const FUELS: readonly FuelType[] = [
  "petrol",
  "diesel",
  "hybrid",
  "plug_in_hybrid",
  "electric",
  "lpg",
  "other"
];
const TRANSMISSIONS: readonly TransmissionType[] = ["manual", "automatic"];
const SELLERS: readonly SellerType[] = ["private", "dealer"];

export class SearchValidationError extends Error {
  public readonly issues: readonly SearchValidationIssue[];

  public constructor(issues: readonly SearchValidationIssue[]) {
    super("Saved search validation failed");
    this.name = "SearchValidationError";
    this.issues = issues;
  }

  public get fieldErrors(): Readonly<Record<string, readonly string[]>> {
    const errors: Record<string, string[]> = {};
    for (const issue of this.issues) {
      (errors[issue.path] ??= []).push(issue.message);
    }
    return errors;
  }
}

export function validateVehicleSearch(
  input: VehicleSearchDraft,
  currentYear = new Date().getUTCFullYear()
): SearchValidationResult {
  const issues: SearchValidationIssue[] = [];
  const name = input.name.trim();

  if (name.length === 0 || name.length > 100) {
    addIssue(issues, "name", "must contain 1-100 characters");
  }
  if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 1_000) {
    addIssue(issues, "priority", "must be an integer from 1 to 1000");
  }
  if (typeof input.active !== "boolean") {
    addIssue(issues, "active", "must be a boolean");
  }

  const scanLimits = validateScanLimits(input.scanLimits, issues);
  validateCriteria(input.criteria, issues, currentYear);
  const location = validateLocation(input, issues);

  const identifyingCriteria = [
    input.criteria.makeKeywords,
    input.criteria.modelKeywords,
    input.criteria.variantKeywords,
    input.criteria.requiredKeywords
  ];
  if (input.criteria.modelTarget == null && !identifyingCriteria.some((criterion) => criterion !== null && criterion.value.length > 0)) {
    addIssue(
      issues,
      "criteria",
      "must include at least one make, model, variant, or required keyword"
    );
  }
  if (
    input.criteria.variantKeywords !== null &&
    input.criteria.makeKeywords === null &&
    input.criteria.modelKeywords === null
  ) {
    addIssue(
      issues,
      "criteria.variantKeywords",
      "requires make or model keywords"
    );
  }

  if (issues.length > 0 || location === undefined) {
    return { success: false, issues };
  }

  const value: ValidatedVehicleSearchDraft = {
    name,
    scanLimits,
    priority: input.priority,
    active: input.active,
    criteria: normalizeCriteria(input.criteria),
    location
  };
  return { success: true, value };
}

export function assertValidVehicleSearch(
  input: VehicleSearchDraft,
  currentYear?: number
): ValidatedVehicleSearchDraft {
  const result = validateVehicleSearch(input, currentYear);
  if (!result.success) throw new SearchValidationError(result.issues);
  return result.value;
}

function validateCriteria(
  criteria: VehicleSearchCriteria,
  issues: SearchValidationIssue[],
  currentYear: number
): void {
  if (criteria.modelTarget != null) {
    const target = criteria.modelTarget;
    if (target.strength !== "hard") addIssue(issues, "criteria.modelTarget", "model targets must be hard requirements");
    for (const field of ["make", "model"] as const) {
      if (typeof target.value?.[field] !== "string" || !target.value[field].trim() || target.value[field].length > 80 || /[,;|]/.test(target.value[field])) {
        addIssue(issues, `criteria.modelTarget.${field}`, "enter one make and model per target (1-80 characters)");
      }
    }
    if (target.value?.variant !== null && (typeof target.value?.variant !== "string" || target.value.variant.length > 80 || /[,;|]/.test(target.value.variant))) addIssue(issues, "criteria.modelTarget.variant", "enter one optional variant (up to 80 characters)");
    if (criteria.makeKeywords !== null || criteria.modelKeywords !== null || criteria.variantKeywords !== null) addIssue(issues, "criteria.modelTarget", "use a model target or identity keywords, not both");
  }
  validateKeywords(criteria.makeKeywords, "criteria.makeKeywords", issues);
  validateKeywords(criteria.modelKeywords, "criteria.modelKeywords", issues);
  validateKeywords(criteria.variantKeywords, "criteria.variantKeywords", issues);
  validateKeywords(criteria.requiredKeywords, "criteria.requiredKeywords", issues);
  validateKeywords(criteria.excludedKeywords, "criteria.excludedKeywords", issues);

  if (criteria.priceRange !== null) {
    validateStrength(criteria.priceRange, "criteria.priceRange", issues);
    const { minimumEur, maximumEur } = criteria.priceRange.value;
    if (minimumEur === null && maximumEur === null) {
      addIssue(issues, "criteria.priceRange", "must include a minimum or maximum EUR price");
    }
    validateOptionalInteger(minimumEur, "criteria.priceRange.minimumEur", 0, issues);
    validateOptionalInteger(maximumEur, "criteria.priceRange.maximumEur", 0, issues);
    if (minimumEur !== null && maximumEur !== null && minimumEur > maximumEur) {
      addIssue(issues, "criteria.priceRange.maximumEur", "must be at least the minimum EUR price");
    }
  }

  validateNumberConstraint(criteria.minimumYear, "criteria.minimumYear", 1886, currentYear + 1, issues);
  validateNumberConstraint(criteria.maximumMileageKm, "criteria.maximumMileageKm", 0, 10_000_000, issues);
  validateNumberConstraint(criteria.minimumPowerHp, "criteria.minimumPowerHp", 1, 5_000, issues);
  validateSelection(criteria.fuels, "criteria.fuels", FUELS, issues);
  validateSelection(criteria.transmissions, "criteria.transmissions", TRANSMISSIONS, issues);

  if (criteria.sellerPreference !== null) {
    validateStrength(criteria.sellerPreference, "criteria.sellerPreference", issues);
    if (!SELLERS.includes(criteria.sellerPreference.value)) {
      addIssue(issues, "criteria.sellerPreference.value", "must be private or dealer");
    }
  }

  const required = new Set(
    (criteria.requiredKeywords?.value ?? []).map((keyword) => keyword.trim().toLocaleLowerCase("en"))
  );
  for (const keyword of criteria.excludedKeywords?.value ?? []) {
    if (required.has(keyword.trim().toLocaleLowerCase("en"))) {
      addIssue(
        issues,
        "criteria.excludedKeywords",
        `cannot exclude required keyword \"${keyword.trim()}\"`
      );
    }
  }
}

function validateLocation(
  input: VehicleSearchDraft,
  issues: SearchValidationIssue[]
): ValidatedVehicleSearchDraft["location"] | undefined {
  const { location } = input;
  if (location.mode === "nationwide") {
    if (location.origin !== null) {
      addIssue(issues, "location.origin", "must be empty in nationwide mode");
    }
    if (location.radiusKm !== null) {
      addIssue(issues, "location.radiusKm", "must be empty in nationwide mode");
    }
    return { mode: "nationwide", origin: null, radiusKm: null };
  }

  if (location.mode !== "radius") {
    addIssue(issues, "location.mode", "must be radius or nationwide");
    return undefined;
  }
  const origin = location.origin?.trim() ?? "";
  if (origin.length === 0 || origin.length > 160) {
    addIssue(issues, "location.origin", "must contain 1-160 characters in radius mode");
  }
  if (!isSearchRadius(location.radiusKm)) {
    addIssue(
      issues,
      "location.radiusKm",
      `must be one of ${SEARCH_RADIUS_OPTIONS_KM.join(", ")} kilometres`
    );
  }
  if (origin.length === 0 || !isSearchRadius(location.radiusKm)) return undefined;
  return { mode: "radius", origin, radiusKm: location.radiusKm };
}

function isSearchRadius(radiusKm: number | null): radiusKm is SearchRadiusKm {
  return SEARCH_RADIUS_OPTIONS_KM.some((radius) => radius === radiusKm);
}

function validateKeywords(
  constraint: SearchConstraint<string[]> | null,
  path: string,
  issues: SearchValidationIssue[]
): void {
  if (constraint === null) return;
  validateStrength(constraint, path, issues);
  if (!Array.isArray(constraint.value) || constraint.value.length === 0) {
    addIssue(issues, `${path}.value`, "must contain at least one keyword");
    return;
  }
  const normalized = constraint.value.map((keyword) => keyword.trim().toLocaleLowerCase("en"));
  if (normalized.some((keyword) => keyword.length === 0 || keyword.length > 80)) {
    addIssue(issues, `${path}.value`, "keywords must contain 1-80 characters");
  }
  if (new Set(normalized).size !== normalized.length) {
    addIssue(issues, `${path}.value`, "keywords must not contain duplicates");
  }
}

function validateSelection<T extends string>(
  constraint: SearchConstraint<T[]> | null,
  path: string,
  allowed: readonly T[],
  issues: SearchValidationIssue[]
): void {
  if (constraint === null) return;
  validateStrength(constraint, path, issues);
  if (!Array.isArray(constraint.value) || constraint.value.length === 0) {
    addIssue(issues, `${path}.value`, "must contain at least one selection");
    return;
  }
  if (constraint.value.some((value) => !allowed.includes(value))) {
    addIssue(issues, `${path}.value`, `contains an unsupported value`);
  }
  if (new Set(constraint.value).size !== constraint.value.length) {
    addIssue(issues, `${path}.value`, "must not contain duplicates");
  }
}

function validateNumberConstraint(
  constraint: SearchConstraint<number> | null,
  path: string,
  minimum: number,
  maximum: number,
  issues: SearchValidationIssue[]
): void {
  if (constraint === null) return;
  validateStrength(constraint, path, issues);
  if (!Number.isInteger(constraint.value) || constraint.value < minimum || constraint.value > maximum) {
    addIssue(issues, `${path}.value`, `must be an integer from ${minimum} to ${maximum}`);
  }
}

function validateOptionalInteger(
  value: number | null,
  path: string,
  minimum: number,
  issues: SearchValidationIssue[]
): void {
  if (value !== null && (!Number.isInteger(value) || value < minimum)) {
    addIssue(issues, path, `must be a whole number of EUR no lower than ${minimum}`);
  }
}

function validateStrength<T>(
  constraint: SearchConstraint<T>,
  path: string,
  issues: SearchValidationIssue[]
): void {
  if (!STRENGTHS.includes(constraint.strength)) {
    addIssue(issues, `${path}.strength`, "must be hard or soft");
  }
}

function normalizeCriteria(criteria: VehicleSearchCriteria): VehicleSearchCriteria {
  return {
    ...criteria,
    ...(criteria.modelTarget == null ? {} : { modelTarget: { strength: "hard" as const, value: canonicalModelTarget(criteria.modelTarget.value) } }),
    makeKeywords: normalizeKeywords(criteria.makeKeywords),
    modelKeywords: normalizeKeywords(criteria.modelKeywords),
    variantKeywords: normalizeKeywords(criteria.variantKeywords),
    requiredKeywords: normalizeKeywords(criteria.requiredKeywords),
    excludedKeywords: normalizeKeywords(criteria.excludedKeywords),
    fuels: normalizeSelection(criteria.fuels),
    transmissions: normalizeSelection(criteria.transmissions)
  };
}

function normalizeKeywords(
  constraint: SearchConstraint<string[]> | null
): SearchConstraint<string[]> | null {
  if (constraint === null) return null;
  return { ...constraint, value: constraint.value.map((keyword) => keyword.trim()) };
}

function normalizeSelection<T extends string>(
  constraint: SearchConstraint<T[]> | null
): SearchConstraint<T[]> | null {
  if (constraint === null) return null;
  return { ...constraint, value: [...constraint.value] };
}

function addIssue(issues: SearchValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateScanLimits(input: unknown, issues: SearchValidationIssue[]): ScanLimits {
  if (input === undefined) return { ...DEFAULT_SCAN_LIMITS };
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    addIssue(issues, "scanLimits", "must be a scan limits object");
    return { ...DEFAULT_SCAN_LIMITS };
  }
  const limits = input as ScanLimits;
  for (const [field, minimum, maximum] of [
    ["initialCardLimit", 1, 10000], ["knownListingStopCount", 1, 1000],
    ["maxCards", 1, 10000], ["maxDurationSeconds", 15, 1800]
  ] as const) {
    if (!Number.isInteger(limits[field]) || limits[field] < minimum || limits[field] > maximum) {
      addIssue(issues, `scanLimits.${field}`, `must be an integer from ${minimum} to ${maximum}`);
    }
  }
  if (limits.initialCardLimit > limits.maxCards) addIssue(issues, "scanLimits.initialCardLimit", "must not exceed the maximum cards per scan");
  if (limits.knownListingStopCount > limits.maxCards) addIssue(issues, "scanLimits.knownListingStopCount", "must not exceed the maximum cards per scan");
  return { initialCardLimit: limits.initialCardLimit, knownListingStopCount: limits.knownListingStopCount, maxCards: limits.maxCards, maxDurationSeconds: limits.maxDurationSeconds };
}
