import type {
  ClassifyListingInput,
  ListingClassification,
  ListingPatternCategory,
  ListingSubject,
  MatchedListingPattern
} from "./types.js";

export const LISTING_CLASSIFIER_VERSION = 2;

const PATTERNS = {
  collectible: [
    "hot wheel", "hot wheels", "hotwheels", "miniatura", "die-cast", "1/18", "1/43", "maquete", "brinquedo"
  ],
  part: [
    "peça", "peças", "jante", "jantes", "pneu", "pneus", "rodas de ferro", "espaçador",
    "espaçadores", "volante", "volantes", "banco", "bancos", "palas", "tablier", "rádio",
    "quadrante", "painel", "chave secundária", "chave de rodas", "capa de volante", "macaco",
    "alargador", "alargadores", "calha da água"
  ],
  body_or_light: [
    "farol", "farolim", "faróis", "capô", "para-choque", "guarda-lamas", "grelha",
    "retrovisor", "espelho", "chuventos", "tecto de abrir", "teto de abrir", "aileron", "spoiler"
  ],
  mechanical_or_electrical: [
    "bateria", "módulo", "módulos", "motor", "centralina", "medidor de massa de ar",
    "barra estabilizadora", "sofagem", "fita de airbag"
  ],
  printed_material: ["catálogo", "apresentação"]
} as const satisfies Record<Exclude<ListingPatternCategory, "parts_only">, readonly string[]>;

const PARTS_ONLY_PATTERN = "só para peças";

export function classifyListing(input: ClassifyListingInput): ListingClassification {
  const normalizedTitle = normalizeForMatching(input.title);
  const matchedPatterns: MatchedListingPattern[] = [];
  const partsOnly = matches(normalizedTitle, PARTS_ONLY_PATTERN);

  if (partsOnly) {
    matchedPatterns.push({ category: "parts_only", pattern: PARTS_ONLY_PATTERN });
  }

  for (const [category, patterns] of Object.entries(PATTERNS) as Array<
    [Exclude<ListingPatternCategory, "parts_only">, readonly string[]]
  >) {
    for (const pattern of patterns) {
      if (pattern === "peças" && partsOnly) continue;
      if (matches(normalizedTitle, pattern)) matchedPatterns.push({ category, pattern });
    }
  }

  const subject = classifySubject(matchedPatterns, partsOnly);
  return {
    version: LISTING_CLASSIFIER_VERSION,
    subject,
    condition: partsOnly ? "parts_only" : "unknown",
    decision: matchedPatterns.length === 0 ? "continue" : "exclude",
    matchedPatterns
  };
}

function classifySubject(
  matchedPatterns: readonly MatchedListingPattern[],
  partsOnly: boolean
): ListingSubject {
  if (matchedPatterns.some(({ category }) => category === "collectible")) return "collectible";
  if (matchedPatterns.some(({ category }) => category === "printed_material")) return "printed_material";
  if (partsOnly) return "whole_vehicle";
  if (matchedPatterns.length > 0) return "part_or_accessory";
  return "unknown";
}

function matches(normalizedTitle: string, pattern: string): boolean {
  const normalizedPattern = normalizeForMatching(pattern);
  const escaped = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "u").test(normalizedTitle);
}

function normalizeForMatching(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("pt-PT")
    .replace(/[‐‑‒–—―-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
