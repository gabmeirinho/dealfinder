import { canonicalMake, identityKey } from "@dealfinder/domain";

const RESULTS_URL = "https://www.standvirtual.com/carros";

const MAKE_SLUGS: Readonly<Record<string, string>> = {
  alfaromeo: "alfa-romeo",
  astonmartin: "aston-martin",
  landrover: "land-rover",
  mercedesbenz: "mercedes-benz",
  rollsroyce: "rolls-royce",
  volkswagen: "vw"
};

export interface StandvirtualModelSearchBuild {
  url: string;
  target: {
    make: string;
    model: string;
  };
  standvirtualIds: {
    make: string;
    model: string;
  };
  filters: {
    fuel: "petrol" | null;
    maximumPriceEur: number | null;
  };
}

export interface StandvirtualModelSearchOptions {
  fuel?: "petrol";
  maximumPriceEur?: number;
}

export type StandvirtualPricePolicy = "strict" | "market_evidence";

export interface StandvirtualSearchOptions extends StandvirtualModelSearchOptions {
  make?: string;
  model?: string;
  pricePolicy?: StandvirtualPricePolicy;
}

export function buildStandvirtualSearch(options: StandvirtualSearchOptions = {}) {
  if (options.model !== undefined && options.make === undefined) {
    throw new Error("A model requires a make.");
  }
  if (options.fuel !== undefined && options.fuel !== "petrol") {
    throw new Error("Standvirtual currently supports petrol fuel only.");
  }
  const pricePolicy = options.pricePolicy ?? "strict";
  if (pricePolicy !== "strict" && pricePolicy !== "market_evidence") {
    throw new Error("Price policy must be strict or market_evidence.");
  }
  const maximumPriceEur = options.maximumPriceEur === undefined ? null : requirePrice(options.maximumPriceEur);
  const make = options.make === undefined ? null : canonicalMake(requireValue(options.make, "Make"));
  const model = options.model === undefined ? null : requireValue(options.model, "Model");
  const makeId = make === null ? null : MAKE_SLUGS[identityKey(make)] ?? slug(make, "Make");
  const modelId = model === null ? null : slug(model, "Model");
  const url = new URL(RESULTS_URL);
  if (makeId !== null) url.searchParams.set("search[filter_enum_make][0]", makeId);
  if (modelId !== null) url.searchParams.set("search[filter_enum_model][0]", modelId);
  if (options.fuel !== undefined) url.searchParams.set("search[filter_enum_fuel_type][0]", "gaz");
  const sourceMaximumPrice = pricePolicy === "strict" ? maximumPriceEur : null;
  if (sourceMaximumPrice !== null) url.searchParams.set("search[filter_float_price:to]", String(sourceMaximumPrice));
  return {
    url: url.toString(),
    searchScope: model === null ? "broad" as const : "targeted" as const,
    pricePolicy,
    target: make === null ? null : { make, model },
    standvirtualIds: { make: makeId, model: modelId },
    filters: { fuel: options.fuel ?? null, maximumPriceEur: sourceMaximumPrice }
  };
}

/** Builds Standvirtual's explicit make/model filter URL from a display-name target. */
export function buildStandvirtualModelSearch(
  makeInput: string,
  modelInput: string,
  options: StandvirtualModelSearchOptions = {}
): StandvirtualModelSearchBuild {
  const built = buildStandvirtualSearch({ ...options, make: makeInput, model: modelInput });
  return {
    url: built.url,
    target: { make: built.target!.make, model: built.target!.model! },
    standvirtualIds: { make: built.standvirtualIds.make!, model: built.standvirtualIds.model! },
    filters: built.filters
  };
}

function requirePrice(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_000_000) {
    throw new Error("Maximum price must be an integer between 1 and 10000000 EUR.");
  }
  return value;
}

function requireValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new Error(`${label} must contain 1-100 characters.`);
  }
  return trimmed;
}

function slug(value: string, label: string): string {
  const result = value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (result.length === 0) throw new Error(`${label} must contain letters or numbers.`);
  return result;
}
