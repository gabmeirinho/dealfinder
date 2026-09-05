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

/** Builds Standvirtual's explicit make/model filter URL from a display-name target. */
export function buildStandvirtualModelSearch(
  makeInput: string,
  modelInput: string,
  options: StandvirtualModelSearchOptions = {}
): StandvirtualModelSearchBuild {
  const make = canonicalMake(requireValue(makeInput, "Make"));
  const model = requireValue(modelInput, "Model");
  const makeId = MAKE_SLUGS[identityKey(make)] ?? slug(make, "Make");
  const modelId = slug(model, "Model");
  const url = new URL(RESULTS_URL);
  url.searchParams.set("search[filter_enum_make][0]", makeId);
  url.searchParams.set("search[filter_enum_model][0]", modelId);
  if (options.fuel !== undefined) {
    url.searchParams.set("search[filter_enum_fuel_type][0]", "gaz");
  }
  const maximumPriceEur = options.maximumPriceEur === undefined
    ? null
    : requirePrice(options.maximumPriceEur);
  if (maximumPriceEur !== null) {
    url.searchParams.set("search[filter_float_price:to]", String(maximumPriceEur));
  }
  return {
    url: url.toString(),
    target: { make, model },
    standvirtualIds: { make: makeId, model: modelId },
    filters: { fuel: options.fuel ?? null, maximumPriceEur }
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
