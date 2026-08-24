import type { FuelType, SellerType, TransmissionType } from "../searches/index.js";
import type {
  CoarseSellerSignals,
  NormalizeVehicleInput,
  NormalizedFactField,
  NormalizedVehicleFacts,
  VehicleIndicators
} from "./types.js";

const MAKE_ALIASES: readonly [RegExp, string][] = [
  [/\bmercedes(?:[ -]benz)?\b/iu, "Mercedes-Benz"],
  [/\bland rover\b/iu, "Land Rover"],
  [/\balfa romeo\b/iu, "Alfa Romeo"],
  [/\bvolkswagen\b|\bvw\b/iu, "Volkswagen"],
  [/\bbmw\b/iu, "BMW"],
  [/\baudi\b/iu, "Audi"],
  [/\bpeugeot\b/iu, "Peugeot"],
  [/\brenault\b/iu, "Renault"],
  [/\bcitro[eë]n\b/iu, "Citroën"],
  [/\bseat\b/iu, "SEAT"],
  [/\bskoda\b|\bškoda\b/iu, "Škoda"],
  [/\btoyota\b/iu, "Toyota"],
  [/\bford\b/iu, "Ford"],
  [/\bopel\b/iu, "Opel"],
  [/\bfiat\b/iu, "Fiat"],
  [/\bvolvo\b/iu, "Volvo"],
  [/\bnissan\b/iu, "Nissan"],
  [/\bhonda\b/iu, "Honda"],
  [/\bhyundai\b/iu, "Hyundai"],
  [/\bkia\b/iu, "Kia"],
  [/\bdacia\b/iu, "Dacia"],
  [/\bmini\b/iu, "MINI"],
  [/\btesla\b/iu, "Tesla"]
];

const FUEL_PATTERNS: readonly [FuelType, RegExp][] = [
  ["plug_in_hybrid", /\b(?:plug[ -]?in|phev|h[ií]brido plug[ -]?in)\b/iu],
  ["hybrid", /\b(?:h[ií]brido|hybrid|hev)\b/iu],
  ["electric", /\b(?:el[eé]trico|electric|bev)\b/iu],
  ["lpg", /\b(?:gpl|lpg)\b/iu],
  ["diesel", /\b(?:diesel|gas[oó]leo|gasoil|tdi|dci|hdi|cdti|\d{3}d)\b/iu],
  ["petrol", /\b(?:gasolina|petrol|gasoline|tsi|tfsi)\b/iu]
];

const TRANSMISSION_PATTERNS: readonly [TransmissionType, RegExp][] = [
  ["automatic", /\b(?:autom[aá]tic[oa]|automatic|dsg|cvt|tiptronic)\b/iu],
  ["manual", /\bmanual\b/iu]
];

const INDICATOR_PATTERNS: Record<keyof VehicleIndicators, RegExp> = {
  financing: /\b(?:financiamento|financing|finance available|cr[eé]dito autom[oó]vel)\b/iu,
  monthlyPayment: /(?:\b(?:mensalidade|monthly|por m[eê]s|per month)\b|\b\d[\d., ]*\s*€\s*\/\s*m[eê]s\b)/iu,
  deposit: /\b(?:entrada|sinal|deposit|down payment)\b/iu,
  damaged: /\b(?:acidentad[oa]|sinistrad[oa]|batid[oa]|danificad[oa]|damaged|accident damage|para pe[cç]as|for parts)\b/iu,
  imported: /\b(?:importad[oa]|imported|matr[ií]cula estrangeira|foreign registration)\b/iu
};

export function normalizeVehicleFacts(input: NormalizeVehicleInput): NormalizedVehicleFacts {
  validateInput(input);
  const original = {
    title: input.title,
    description: input.description,
    displayedPrice: input.displayedPrice,
    cardFacts: [...input.cardFacts]
  };
  const sources = [input.title, input.description, ...input.cardFacts]
    .filter((value): value is string => value !== null && value.trim() !== "");
  const combined = sources.join(" · ");
  const evidence: NormalizedVehicleFacts["evidence"] = {};

  const priceCents = normalizeEuroPrice(input.displayedPrice);
  if (priceCents !== null && input.displayedPrice !== null) evidence.priceCents = [input.displayedPrice];
  const yearMatch = findYear(sources, input.referenceYear);
  if (yearMatch !== null) evidence.year = [yearMatch.evidence];
  const mileageMatch = findMileage(sources);
  if (mileageMatch !== null) evidence.mileageKm = [mileageMatch.evidence];
  const powerMatch = findPower(sources);
  if (powerMatch !== null) evidence.powerHp = [powerMatch.evidence];
  const makeModel = findMakeModelVariant(input.title);
  if (makeModel.make !== null) evidence.make = [makeModel.evidence];
  if (makeModel.model !== null) evidence.model = [makeModel.evidence];
  if (makeModel.variant !== null) evidence.variant = [makeModel.evidence];
  const fuel = firstPattern(combined, FUEL_PATTERNS);
  if (fuel !== null) evidence.fuel = [fuel.evidence];
  const transmission = firstPattern(combined, TRANSMISSION_PATTERNS);
  if (transmission !== null) evidence.transmission = [transmission.evidence];

  const indicators = Object.fromEntries(
    Object.entries(INDICATOR_PATTERNS).map(([key, pattern]) => {
      const matches = sources.filter((source) => pattern.test(source));
      if (matches.length > 0) evidence[key as keyof VehicleIndicators] = matches;
      return [key, matches.length > 0];
    })
  ) as unknown as VehicleIndicators;
  const seller = normalizeSeller(input.seller, combined);
  if (seller.type !== null) evidence.sellerType = sources.filter((source) =>
    /\b(?:particular|private seller|profissional|dealer|stand)\b/iu.test(source)
  );

  return {
    original,
    priceCents,
    year: yearMatch?.value ?? null,
    mileageKm: mileageMatch?.value ?? null,
    make: makeModel.make,
    model: makeModel.model,
    variant: makeModel.variant,
    fuel: fuel?.value ?? null,
    transmission: transmission?.value ?? null,
    powerHp: powerMatch?.value ?? null,
    seller,
    indicators,
    evidence
  };
}

export function normalizeEuroPrice(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKC").trim();
  if (/^(?:free|gr[aá]tis|gratuito)$/iu.test(normalized)) return 0;
  if (!normalized.includes("€")) return null;
  const numeric = normalized.replace(/[^\d.,]/gu, "");
  if (numeric === "") return null;
  const separator = Math.max(numeric.lastIndexOf(","), numeric.lastIndexOf("."));
  const decimalDigits = separator < 0 ? 0 : numeric.length - separator - 1;
  const hasCents = decimalDigits === 2;
  const eurosText = (hasCents ? numeric.slice(0, separator) : numeric).replace(/[^\d]/gu, "");
  const centsText = hasCents ? numeric.slice(separator + 1) : "00";
  if (eurosText === "") return null;
  const cents = Number(eurosText) * 100 + Number(centsText);
  return Number.isSafeInteger(cents) ? cents : null;
}

function findYear(sources: readonly string[], referenceYear: number) {
  for (const source of sources) {
    for (const match of source.matchAll(/\b(?:19|20)\d{2}\b/gu)) {
      const value = Number(match[0]);
      if (value >= 1950 && value <= referenceYear + 1) return { value, evidence: source };
    }
  }
  return null;
}

function findMileage(sources: readonly string[]) {
  const pattern = /\b(\d{1,3}(?:[ .]\d{3})+|\d+(?:[.,]\d+)?\s*(?:k|mil)?)\s*(km|kms|quil[oó]metros?|mi|miles?)\b/iu;
  for (const source of sources) {
    const match = source.match(pattern);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const amount = parseMagnitude(match[1]);
    if (amount === null) continue;
    const value = /^(?:mi|miles?)$/iu.test(match[2]) ? Math.round(amount * 1.609344) : Math.round(amount);
    if (value >= 0 && value <= 3_000_000) return { value, evidence: source };
  }
  return null;
}

function findPower(sources: readonly string[]) {
  const pattern = /\b(\d{2,4})\s*(cv|hp|bhp|kw)\b/iu;
  for (const source of sources) {
    const match = source.match(pattern);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const amount = Number(match[1]);
    const value = match[2].toLocaleLowerCase("en") === "kw" ? Math.round(amount * 1.34102) : amount;
    if (value >= 20 && value <= 2_000) return { value, evidence: source };
  }
  return null;
}

function findMakeModelVariant(title: string): {
  make: string | null;
  model: string | null;
  variant: string | null;
  evidence: string;
} {
  const normalized = title.replace(/^\s*(?:19|20)\d{2}\s+/u, "").trim();
  const matched = MAKE_ALIASES.find(([pattern]) => pattern.test(normalized));
  if (matched === undefined) return { make: null, model: null, variant: null, evidence: title };
  const match = normalized.match(matched[0]);
  const remainder = normalized.slice((match?.index ?? 0) + (match?.[0].length ?? 0)).trim();
  const tokens = remainder.split(/\s+/u).filter(Boolean);
  const model = cleanVehicleToken(tokens.shift() ?? null);
  const variantTokens = tokens.filter((token) =>
    !/^(?:19|20)\d{2}$/u.test(token) &&
    !/^(?:manual|autom[aá]tic[oa]|diesel|gas[oó]leo|gasolina|petrol|hybrid|h[ií]brido|electric|el[eé]trico)$/iu.test(token)
  );
  const variant = variantTokens.length === 0 ? null : variantTokens.join(" ");
  return { make: matched[1], model, variant, evidence: title };
}

function cleanVehicleToken(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, "");
  return cleaned === "" ? null : cleaned;
}

function firstPattern<T>(text: string, patterns: readonly [T, RegExp][]): { value: T; evidence: string } | null {
  for (const [value, pattern] of patterns) {
    const match = text.match(pattern);
    if (match !== null) return { value, evidence: match[0] };
  }
  return null;
}

function parseMagnitude(value: string): number | null {
  const compact = value.toLocaleLowerCase("en").replace(/\s+/gu, "");
  const multiplier = /(?:k|mil)$/u.test(compact) ? 1_000 : 1;
  const numeric = compact.replace(/(?:k|mil)$/u, "");
  const normalized = multiplier === 1
    ? numeric.replace(/[ ,.]/gu, "")
    : numeric.replace(",", ".");
  const result = Number(normalized) * multiplier;
  return Number.isFinite(result) ? result : null;
}

function normalizeSeller(input: Partial<CoarseSellerSignals> | undefined, text: string): CoarseSellerSignals {
  const inferredType: SellerType | null = /\b(?:profissional|dealer|stand)\b/iu.test(text)
    ? "dealer"
    : /\b(?:particular|private seller)\b/iu.test(text) ? "private" : null;
  return {
    type: input?.type ?? inferredType,
    rating: input?.rating ?? null,
    ratingCount: input?.ratingCount ?? null,
    inventorySize: input?.inventorySize ?? null
  };
}

function validateInput(input: NormalizeVehicleInput): void {
  if (input.title.trim() === "") throw new Error("A non-empty original title is required");
  if (input.title.length > 1000) throw new Error("Original title must be at most 1000 characters");
  if (input.description !== null && input.description.length > 20_000) {
    throw new Error("Original description must be at most 20000 characters");
  }
  if (input.cardFacts.some((fact) => fact.length === 0 || fact.length > 1000)) {
    throw new Error("Original card facts must contain 1-1000 characters");
  }
  const originalTextFields = [input.title, input.description, ...input.cardFacts]
    .filter((value): value is string => value !== null);
  if (containsSellerIdentityOrContactData(originalTextFields)) {
    throw new Error("Seller identity or contact data is not accepted for normalization");
  }
  if (!Number.isInteger(input.referenceYear) || input.referenceYear < 1950 || input.referenceYear > 9999) {
    throw new Error("Reference year must be a four-digit year");
  }
  const seller = input.seller;
  if (seller?.rating !== undefined && seller.rating !== null &&
      (!Number.isFinite(seller.rating) || seller.rating < 0 || seller.rating > 5)) {
    throw new Error("Seller rating must be between zero and five");
  }
  for (const [label, value] of [
    ["Seller rating count", seller?.ratingCount],
    ["Seller inventory size", seller?.inventorySize]
  ] as const) {
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${label} must be a non-negative integer`);
    }
  }
}

export function containsSellerIdentityOrContactData(fields: readonly string[]): boolean {
  return fields.some((text) =>
    /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/iu.test(text) ||
    /(?:\+?\d[\s().-]*){9,}/u.test(text) ||
    /(?:wa\.me|whatsapp|facebook\.com\/(?:profile|people|user)|mailto:|tel:)/iu.test(text)
  );
}

export type { NormalizedFactField };
