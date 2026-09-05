import {
  createVehicleSearchDraft,
  type ConstraintStrength,
  type FuelType,
  type ManagedVehicleSearch,
  type SearchRadiusKm,
  type SellerType,
  type TransmissionType,
  type VehicleSearchDraft
} from "@dealfinder/domain";

export interface ModelTargetForm {
  make: string;
  model: string;
  variant: string;
  maximumPriceEur: string;
  minimumYear: string;
  maximumMileageKm: string;
}

export function emptyModelTarget(): ModelTargetForm {
  return { make: "", model: "", variant: "", maximumPriceEur: "", minimumYear: "", maximumMileageKm: "" };
}

export interface SearchFormModel {
  modelTargets: ModelTargetForm[];
  name: string;
  priority: string;
  active: boolean;
  makeKeywords: string;
  makeStrength: ConstraintStrength;
  modelKeywords: string;
  modelStrength: ConstraintStrength;
  variantKeywords: string;
  variantStrength: ConstraintStrength;
  minimumPriceEur: string;
  maximumPriceEur: string;
  priceStrength: ConstraintStrength;
  minimumYear: string;
  yearStrength: ConstraintStrength;
  maximumMileageKm: string;
  mileageStrength: ConstraintStrength;
  fuels: FuelType[];
  fuelStrength: ConstraintStrength;
  transmissions: TransmissionType[];
  transmissionStrength: ConstraintStrength;
  minimumPowerHp: string;
  powerStrength: ConstraintStrength;
  sellerPreference: SellerType | "";
  sellerStrength: ConstraintStrength;
  requiredKeywords: string;
  requiredStrength: ConstraintStrength;
  excludedKeywords: string;
  excludedStrength: ConstraintStrength;
  locationMode: "radius" | "nationwide";
  origin: string;
  radiusKm: SearchRadiusKm;
}

export function createSearchForm(priority = 1): SearchFormModel {
  return draftToSearchForm({
    ...createVehicleSearchDraft(""),
    priority
  });
}

export function draftToSearchForm(
  search: VehicleSearchDraft | ManagedVehicleSearch
): SearchFormModel {
  const criteria = search.criteria;
  return {
    modelTargets: criteria.modelTarget == null ? [] : [{ ...emptyModelTarget(), ...criteria.modelTarget.value, variant: criteria.modelTarget.value.variant ?? "" }],
    name: search.name,
    priority: String(search.priority),
    active: search.active,
    makeKeywords: joinKeywords(criteria.makeKeywords?.value),
    makeStrength: criteria.makeKeywords?.strength ?? "hard",
    modelKeywords: joinKeywords(criteria.modelKeywords?.value),
    modelStrength: criteria.modelKeywords?.strength ?? "hard",
    variantKeywords: joinKeywords(criteria.variantKeywords?.value),
    variantStrength: criteria.variantKeywords?.strength ?? "soft",
    minimumPriceEur: toText(criteria.priceRange?.value.minimumEur),
    maximumPriceEur: toText(criteria.priceRange?.value.maximumEur),
    priceStrength: criteria.priceRange?.strength ?? "hard",
    minimumYear: toText(criteria.minimumYear?.value),
    yearStrength: criteria.minimumYear?.strength ?? "hard",
    maximumMileageKm: toText(criteria.maximumMileageKm?.value),
    mileageStrength: criteria.maximumMileageKm?.strength ?? "hard",
    fuels: [...(criteria.fuels?.value ?? [])],
    fuelStrength: criteria.fuels?.strength ?? "hard",
    transmissions: [...(criteria.transmissions?.value ?? [])],
    transmissionStrength: criteria.transmissions?.strength ?? "soft",
    minimumPowerHp: toText(criteria.minimumPowerHp?.value),
    powerStrength: criteria.minimumPowerHp?.strength ?? "soft",
    sellerPreference: criteria.sellerPreference?.value ?? "",
    sellerStrength: criteria.sellerPreference?.strength ?? "soft",
    requiredKeywords: joinKeywords(criteria.requiredKeywords?.value),
    requiredStrength: criteria.requiredKeywords?.strength ?? "hard",
    excludedKeywords: joinKeywords(criteria.excludedKeywords?.value),
    excludedStrength: criteria.excludedKeywords?.strength ?? "hard",
    locationMode: search.location.mode,
    origin: search.location.origin ?? "Lisbon, Portugal",
    radiusKm: (search.location.radiusKm ?? 150) as SearchRadiusKm
  };
}

export function searchFormToDraft(form: SearchFormModel): VehicleSearchDraft {
  const minimumPriceEur = numberOrNull(form.minimumPriceEur);
  const maximumPriceEur = numberOrNull(form.maximumPriceEur);
  return {
    name: form.name,
    priority: Number(form.priority),
    active: form.active,
    criteria: {
      ...(form.modelTargets.length === 0 ? {} : { modelTarget: { strength: "hard" as const, value: { make: form.modelTargets[0]!.make, model: form.modelTargets[0]!.model, variant: form.modelTargets[0]!.variant || null } } }),
      makeKeywords: form.modelTargets.length ? null : keywordConstraint(form.makeKeywords, form.makeStrength),
      modelKeywords: form.modelTargets.length ? null : keywordConstraint(form.modelKeywords, form.modelStrength),
      variantKeywords: form.modelTargets.length ? null : keywordConstraint(form.variantKeywords, form.variantStrength),
      priceRange: minimumPriceEur === null && maximumPriceEur === null
        ? null
        : {
            value: { minimumEur: minimumPriceEur, maximumEur: maximumPriceEur },
            strength: form.priceStrength
          },
      minimumYear: numberConstraint(form.minimumYear, form.yearStrength),
      maximumMileageKm: numberConstraint(form.maximumMileageKm, form.mileageStrength),
      fuels: form.fuels.length === 0
        ? null
        : { value: [...form.fuels], strength: form.fuelStrength },
      transmissions: form.transmissions.length === 0
        ? null
        : { value: [...form.transmissions], strength: form.transmissionStrength },
      minimumPowerHp: numberConstraint(form.minimumPowerHp, form.powerStrength),
      sellerPreference: form.sellerPreference === ""
        ? null
        : { value: form.sellerPreference, strength: form.sellerStrength },
      requiredKeywords: keywordConstraint(form.requiredKeywords, form.requiredStrength),
      excludedKeywords: keywordConstraint(form.excludedKeywords, form.excludedStrength)
    },
    location: form.locationMode === "nationwide"
      ? { mode: "nationwide", origin: null, radiusKm: null }
      : { mode: "radius", origin: form.origin, radiusKm: form.radiusKm }
  };
}

function keywordConstraint(value: string, strength: ConstraintStrength) {
  const keywords = value.split(",").map((keyword) => keyword.trim()).filter(Boolean);
  return keywords.length === 0 ? null : { value: keywords, strength };
}

function numberConstraint(value: string, strength: ConstraintStrength) {
  const number = numberOrNull(value);
  return number === null ? null : { value: number, strength };
}

function numberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function joinKeywords(value: readonly string[] | undefined): string {
  return value?.join(", ") ?? "";
}

function toText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Defaults are copied into independent searches; subsequent edits are per model. */
export function modelFormsToDrafts(form: SearchFormModel): VehicleSearchDraft[] {
  return form.modelTargets.map((target, index) => searchFormToDraft({
    ...form,
    name: form.name.trim() ? `${form.name.trim()} · ${target.make} ${target.model}${target.variant ? ` ${target.variant}` : ""}` : `${target.make} ${target.model}${target.variant ? ` ${target.variant}` : ""}`,
    priority: String(Number(form.priority) + index),
    modelTargets: [target],
    maximumPriceEur: target.maximumPriceEur || form.maximumPriceEur,
    minimumYear: target.minimumYear || form.minimumYear,
    maximumMileageKm: target.maximumMileageKm || form.maximumMileageKm
  }));
}
