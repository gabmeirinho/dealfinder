import { parse } from "parse5";
import { containsSellerIdentityOrContactData, type FuelType, type TransmissionType } from "@dealfinder/domain";

import {
  FACEBOOK_DETAIL_CONTRACT_VERSION,
  FacebookDetailContractError,
  type FacebookListingDetail,
  type FacebookListingStructuredFacts
} from "./types.js";

interface HtmlAttribute {
  name: string;
  value: string;
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
}

const DESCRIPTION_TEST_ID = /(?:^|[-_:])description(?:$|[-_:])/iu;
const DESCRIPTION_LABEL = /\bdescription\b|descri[cç][aã]o|descripci[oó]n/iu;
const LISTING_DATA_KEY = /(?:marketplace|listing|vehicle|product|item|ad)/iu;
const LISTING_PAYLOAD_KEY = /(?:marketplace[_-]?listing|listing[_-]?(?:details?|data)|vehicle[_-]?(?:details?|data)|marketplaceListing)/iu;

/** Parse description content from stable Facebook labels and localized section headings. */
export function parseFacebookListingDetail(html: string): FacebookListingDetail {
  if (html.trim() === "") throw contractError("The Facebook listing detail page was empty");
  const document = parse(html) as unknown as HtmlNode;
  const descriptions = [
    ...findAll(document, isDescriptionNode).map(textContent),
    ...findAll(document, isDescriptionMeta).map((node) => attribute(node, "content") ?? ""),
    ...findStructuredDescriptions(document),
    ...findDescriptionsAfterHeadings(document)
  ]
    .map(normalizeText)
    .filter((value) => value.length > 0);
  const description = descriptions.sort((left, right) => right.length - left.length)[0];
  const structuredFacts = findStructuredVehicleFacts(document);
  if (description === undefined && structuredFacts === null) {
    throw contractError("No labelled listing description or structured vehicle facts were found");
  }
  if (description !== undefined && description.length > 20_000) {
    throw contractError("Listing description exceeds 20000 characters");
  }
  if (description !== undefined && containsSellerIdentityOrContactData([description])) {
    throw contractError("Seller identity or contact data is not accepted");
  }
  return {
    contractVersion: FACEBOOK_DETAIL_CONTRACT_VERSION,
    description: description ?? null,
    ...(structuredFacts === null ? {} : { structuredFacts })
  };
}

function isDescriptionNode(node: HtmlNode): boolean {
  const testId = attribute(node, "data-testid");
  const field = attribute(node, "data-dealfinder-field");
  const preview = attribute(node, "data-ad-preview");
  const ariaLabel = attribute(node, "aria-label");
  return field === "description" ||
    (testId !== null && DESCRIPTION_TEST_ID.test(testId)) ||
    preview === "message" ||
    attribute(node, "data-ad-comet-preview") === "message" ||
    (ariaLabel !== null && DESCRIPTION_LABEL.test(ariaLabel));
}

function isDescriptionMeta(node: HtmlNode): boolean {
  if (node.tagName !== "meta") return false;
  const property = attribute(node, "property") ?? attribute(node, "name");
  return property !== null && /^(?:og:description|description)$/iu.test(property);
}

function findStructuredDescriptions(document: HtmlNode): string[] {
  return findAll(document, (node) => node.tagName === "script")
    .flatMap((node) => {
      const source = decodeStructuredSource(textContent(node).trim());
      if (source === "") return [];
      const value = parseEmbeddedJson(source);
      const isJsonLd = /application\/ld\+json/iu.test(attribute(node, "type") ?? "");
      const parsed = value === undefined ? [] : collectDescriptionProperties(value, isJsonLd);
      const raw = LISTING_PAYLOAD_KEY.test(source)
        ? [propertyString(source, "description")].filter((description): description is string => description !== null)
        : [];
      return [...parsed, ...raw];
    });
}

/**
 * Extracts only the small, non-sensitive vehicle subset Facebook exposes in
 * Relay data. This deliberately does not retain seller, location, photo, or
 * identifier fields. Facebook's scripts are not guaranteed to be standalone
 * JSON, so properties are read conservatively from script text instead.
 */
function findStructuredVehicleFacts(document: HtmlNode): FacebookListingStructuredFacts | null {
  const source = findAll(document, (node) => node.tagName === "script")
    .map(textContent)
    .join("\n");
  const normalizedSource = decodeStructuredSource(source);
  if (normalizedSource.trim() === "") return null;

  const odometer = propertyObjectAny(normalizedSource, [
    "vehicle_odometer_data", "odometer_data", "odometerData"
  ]);
  const odometerUnit = propertyStringAny(odometer, ["unit", "units"]);
  const odometerValue = propertyNumberAny(odometer, ["value", "amount"]);
  const mileageKm = odometerValue === null || odometerUnit === null
    ? null
    : normalizeOdometer(odometerValue, odometerUnit);
  const year = normalizeYear(propertyNumberAny(normalizedSource, [
    "vehicle_year", "vehicleYear", "model_year", "modelYear"
  ]));
  const make = propertyStringAny(normalizedSource, [
    "vehicle_make_display_name", "vehicle_make", "vehicleMake", "make"
  ]);
  const modelDisplay = propertyStringAny(normalizedSource, [
    "vehicle_model_display_name", "vehicle_model", "vehicleModel", "model"
  ]);
  const trim = propertyStringAny(normalizedSource, [
    "vehicle_trim_display_name", "vehicle_trim", "vehicleTrim", "trim"
  ]);
  const modelParts = splitModelDisplay(modelDisplay, trim);
  const fuel = normalizeFuel(propertyStringAny(normalizedSource, [
    "vehicle_fuel_type", "vehicle_fuel", "fuel_type", "fuelType", "fuel"
  ]));
  const transmission = normalizeTransmission(propertyStringAny(normalizedSource, [
    "vehicle_transmission_type", "vehicle_transmission", "transmission_type", "transmissionType", "transmission"
  ]));
  const specifications = propertyObjectAny(normalizedSource, [
    "vehicle_specifications", "vehicleSpecifications", "specifications"
  ]);
  const powerHp = normalizePower(propertyNumberAny(specifications, [
    "horse_power", "horsepower", "power_hp", "powerHp"
  ]));
  const condition = propertyStringAny(normalizedSource, ["vehicle_condition", "condition"]);
  const listingCondition = propertyStringAny(normalizedSource, [
    "listing_condition", "listingCondition"
  ]);

  if (mileageKm === null && year === null && make === null && modelParts.model === null &&
      modelParts.variant === null && fuel === null && transmission === null && powerHp === null &&
      condition === null && listingCondition === null) {
    return null;
  }
  return {
    year,
    mileageKm,
    make: cleanStructuredText(make),
    model: cleanStructuredText(modelParts.model),
    variant: cleanStructuredText(modelParts.variant),
    fuel,
    transmission,
    powerHp,
    condition: cleanStructuredText(condition),
    listingCondition: cleanStructuredText(listingCondition)
  };
}

function propertyObjectAny(source: string | null, names: readonly string[]): string | null {
  for (const name of names) {
    const value = propertyObject(source, name);
    if (value !== null) return value;
  }
  return null;
}

function propertyObject(source: string | null, name: string): string | null {
  if (source === null) return null;
  for (const start of propertyStarts(source, name)) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
}

function propertyStringAny(source: string | null, names: readonly string[]): string | null {
  if (source === null || source.trim() === "") return null;

  for (const name of names) {
    const value = propertyString(source, name);
    if (value !== null) return value;
  }
  return null;
}

function propertyString(source: string | null, name: string): string | null {
  const value = propertyRaw(source, name);
  if (value !== null && value !== "null") return decodeStructuredString(value);
  const nested = propertyObject(source, name);
  return nested === null
    ? null
    : propertyStringAny(nested, ["value", "name", "display_name", "displayName", "label"]);
}

function propertyNumberAny(source: string | null, names: readonly string[]): number | null {
  if (source === null || source.trim() === "") return null;

  for (const name of names) {
    const value = propertyNumber(source, name);
    if (value !== null) return value;
  }
  return null;
}

function propertyNumber(source: string | null, name: string): number | null {
  const value = propertyRaw(source, name);
  if (value !== null && value !== "null") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const nested = propertyObject(source, name);
  return nested === null ? null : propertyNumberAny(nested, ["value", "amount", "number"]);
}

function propertyRaw(source: string | null, name: string): string | null {
  if (source === null) return null;
  for (const start of propertyStarts(source, name)) {
    const remainder = source.slice(start).trimStart();
    if (remainder.startsWith('"') || remainder.startsWith("'")) {
      const quote = remainder[0];
      const match = remainder.match(new RegExp(`^${quote}((?:\\\\.|[^${quote}\\\\])*)${quote}`, "u"));
      if (match?.[1] !== undefined) return match[1];
      continue;
    }
    const match = remainder.match(/^(?:null|-?\d+(?:\.\d+)?)/u);
    if (match?.[0] !== undefined && match[0] !== "null") return match[0];
  }
  return null;
}

function propertyStarts(source: string, name: string): number[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const key = `(?:"${escaped}"|'${escaped}'|${escaped})`;
  const pattern = new RegExp(`(?:^|[\\[{,])\\s*${key}\\s*:\\s*`, "giu");
  const starts: number[] = [];
  for (const match of source.matchAll(pattern)) {
    starts.push((match.index ?? 0) + match[0].length);
  }
  return starts;
}

function decodeStructuredString(value: string): string {
  return value
    .replace(/\\u([0-9a-f]{4})/giu, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'")
    .trim();
}

function decodeStructuredSource(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#x22;", '"')
    .replaceAll('\\"', '"');
}

function parseEmbeddedJson(source: string): unknown | undefined {
  for (const candidate of [
    source,
    source.replace(/^\s*(?:for\s*\(;;\);|while\s*\(1\);)/u, "").trim()
  ]) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Facebook also embeds executable Relay data; string extraction handles that form.
    }
  }
  return undefined;
}

function normalizeYear(value: number | null): number | null {
  if (value === null || !Number.isSafeInteger(value) || value < 1950 || value > 2_100) return null;
  return value;
}

function normalizeOdometer(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const normalized = unit.toLocaleLowerCase("en");
  const kilometers = normalized.includes("mile") ? value * 1.609344 : value;
  const rounded = Math.round(kilometers);
  return rounded <= 3_000_000 ? rounded : null;
}

function splitModelDisplay(model: string | null, trim: string | null): { model: string | null; variant: string | null } {
  const modelText = cleanStructuredText(model);
  const trimText = cleanStructuredText(trim);
  if (modelText === null) return { model: null, variant: trimText };
  const [first, ...rest] = modelText.split(/\s+/u);
  const variantParts = [...rest, ...(trimText === null ? [] : [trimText])].filter(Boolean);
  return { model: first ?? null, variant: variantParts.length === 0 ? null : variantParts.join(" ") };
}

function normalizeFuel(value: string | null): FuelType | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.toLocaleLowerCase("en");
  if (/(?:diesel|gas[oó]leo|gasoil)/u.test(normalized)) return "diesel";
  if (/(?:petrol|gasoline|gasolina)/u.test(normalized)) return "petrol";
  if (/(?:plug.?in|phev)/u.test(normalized)) return "plug_in_hybrid";
  if (/(?:hybrid|h[ií]brido|hev)/u.test(normalized)) return "hybrid";
  if (/(?:electric|el[eé]trico|bev)/u.test(normalized)) return "electric";
  if (/(?:lpg|gpl)/u.test(normalized)) return "lpg";
  return "other";
}

function normalizeTransmission(value: string | null): TransmissionType | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.toLocaleLowerCase("en");
  if (/(?:automatic|autom[aá]tic|dsg|cvt|tiptronic)/u.test(normalized)) return "automatic";
  if (/manual/u.test(normalized)) return "manual";
  return null;
}

function normalizePower(value: number | null): number | null {
  if (value === null || !Number.isSafeInteger(value) || value < 20 || value > 2_000) return null;
  return value;
}

function cleanStructuredText(value: string | null): string | null {
  if (value === null) return null;
  const clean = normalizeText(value);
  return clean === "" ? null : clean.slice(0, 200);
}

function collectDescriptionProperties(value: unknown, listingContext = false): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectDescriptionProperties(item, listingContext));
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const type = typeof record["@type"] === "string" ? record["@type"] : "";
  const currentContext = listingContext || LISTING_DATA_KEY.test(Object.keys(record).join(" ")) ||
    /product|vehicle|listing|ad/iu.test(type);
  const own = currentContext && typeof record.description === "string" ? [record.description] : [];
  return [
    ...own,
    ...Object.entries(record).flatMap(([key, child]) =>
      collectDescriptionProperties(child, currentContext || LISTING_DATA_KEY.test(key)))
  ];
}

function findDescriptionsAfterHeadings(node: HtmlNode): string[] {
  const children = node.childNodes ?? [];
  const descriptions: string[] = [];
  for (let index = 0; index < children.length; index += 1) {
    if (isDescriptionHeadingContainer(children[index] as HtmlNode)) {
      for (const sibling of children.slice(index + 1, index + 3)) {
        const value = normalizeText(textContent(sibling as HtmlNode));
        if (value !== "") descriptions.push(value);
      }
    }
    descriptions.push(...findDescriptionsAfterHeadings(children[index] as HtmlNode));
  }
  return descriptions;
}

function isDescriptionHeading(node: HtmlNode): boolean {
  const value = normalizeText(textContent(node));
  return /^(?:description|seller(?:'s|’s)? description|description du vendeur|descri[cç][aã]o(?: do vendedor)?|descripci[oó]n(?: del vendedor)?)$/iu.test(value);
}

function isDescriptionHeadingContainer(node: HtmlNode): boolean {
  const value = normalizeText(textContent(node));
  if (value.length > 200) return false;
  if (isDescriptionHeading(node)) return true;
  if (node.tagName === "script") return false;
  const meaningfulChildren = (node.childNodes ?? [])
    .filter((child) => normalizeText(rawTextContent(child)) !== "");
  return meaningfulChildren.length === 1 &&
    isDescriptionHeadingContainer(meaningfulChildren[0] as HtmlNode);
}

function textContent(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  if (isLocationMetadataNode(node)) return "";
  return (node.childNodes ?? []).map(textContent).join(" ");
}

function isLocationMetadataNode(node: HtmlNode): boolean {
  if (node.tagName === undefined) return false;
  const value = normalizeText(rawTextContent(node));
  if (value.length > 200 || !isLocationMetadataText(value)) return false;
  const childValues = (node.childNodes ?? [])
    .filter((child) => child.tagName !== undefined)
    .map(rawTextContent)
    .map(normalizeText)
    .filter((childValue) => childValue !== "");
  return childValues.length === 0 || childValues.every(isLocationMetadataText);
}

function isLocationMetadataText(value: string): boolean {
  return /(?:location|localização|localisation|ubicación|standort).{0,40}(?:approximate|aproximad|approximatif|approximative|aproximada|ungefähr)|(?:approximate|aproximad|approximatif|approximative|aproximada|ungefähr).{0,40}(?:location|localização|localisation|ubicación|standort)/iu.test(value);
}

function rawTextContent(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(rawTextContent).join(" ");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function attribute(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((candidate) => candidate.name === name)?.value ?? null;
}

function findAll(node: HtmlNode, predicate: (candidate: HtmlNode) => boolean): HtmlNode[] {
  const found = predicate(node) ? [node] : [];
  return found.concat((node.childNodes ?? []).flatMap((child) => findAll(child, predicate)));
}

function contractError(message: string): FacebookDetailContractError {
  return new FacebookDetailContractError(message);
}

export * from "./types.js";
