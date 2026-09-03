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
  if (description === undefined) {
    throw contractError("No labelled listing description was found");
  }
  if (description.length > 20_000) {
    throw contractError("Listing description exceeds 20000 characters");
  }
  if (containsSellerIdentityOrContactData([description])) {
    throw contractError("Seller identity or contact data is not accepted");
  }
  const structuredFacts = findStructuredVehicleFacts(document);
  return {
    contractVersion: FACEBOOK_DETAIL_CONTRACT_VERSION,
    description,
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
    (ariaLabel !== null && DESCRIPTION_TEST_ID.test(ariaLabel));
}

function isDescriptionMeta(node: HtmlNode): boolean {
  if (node.tagName !== "meta") return false;
  const property = attribute(node, "property") ?? attribute(node, "name");
  return property !== null && /^(?:og:description|description)$/iu.test(property);
}

function findStructuredDescriptions(document: HtmlNode): string[] {
  return findAll(document, (node) => node.tagName === "script")
    .filter((node) => /application\/ld\+json/iu.test(attribute(node, "type") ?? ""))
    .flatMap((node) => {
      const source = textContent(node).trim();
      if (source === "") return [];
      try {
        const value: unknown = JSON.parse(source);
        return collectDescriptionProperties(value);
      } catch {
        return [];
      }
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
    .join("\n")
    .replaceAll('\\"', '"');
  if (source.trim() === "") return null;

  const odometer = propertyObject(source, "vehicle_odometer_data");
  const odometerUnit = propertyString(odometer, "unit");
  const odometerValue = propertyNumber(odometer, "value");
  const mileageKm = odometerValue === null || odometerUnit === null
    ? null
    : normalizeOdometer(odometerValue, odometerUnit);
  // `custom_title` is reused by unrelated recommended listings on the same
  // page, so the title/year remains sourced from the selected listing itself.
  const year = null;
  const make = propertyString(source, "vehicle_make_display_name");
  const modelDisplay = propertyString(source, "vehicle_model_display_name");
  const trim = propertyString(source, "vehicle_trim_display_name");
  const modelParts = splitModelDisplay(modelDisplay, trim);
  const fuel = normalizeFuel(propertyString(source, "vehicle_fuel_type"));
  const transmission = normalizeTransmission(propertyString(source, "vehicle_transmission_type"));
  const specifications = propertyObject(source, "vehicle_specifications");
  const powerHp = normalizePower(propertyNumber(specifications, "horse_power"));
  const condition = propertyString(source, "vehicle_condition");
  const listingCondition = null;

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

function propertyObject(source: string | null, name: string): string | null {
  if (source === null) return null;
  for (const start of propertyStarts(source, name)) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
}

function propertyString(source: string | null, name: string): string | null {
  const value = propertyRaw(source, name);
  return value !== null && value !== "null" ? decodeStructuredString(value) : null;
}

function propertyNumber(source: string | null, name: string): number | null {
  const value = propertyRaw(source, name);
  if (value === null || value === "null") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function propertyRaw(source: string | null, name: string): string | null {
  if (source === null) return null;
  for (const start of propertyStarts(source, name)) {
    const remainder = source.slice(start).trimStart();
    if (remainder.startsWith('"')) {
      const match = remainder.match(/^"((?:\\.|[^"\\])*)"/u);
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
  const pattern = new RegExp(`(?:^|[,{])\\s*"${escaped}"\\s*:\\s*`, "giu");
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
    .trim();
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

function collectDescriptionProperties(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectDescriptionProperties);
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const own = typeof record.description === "string" ? [record.description] : [];
  return [...own, ...Object.values(record).flatMap(collectDescriptionProperties)];
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
  return /^(?:description|seller description|description du vendeur|descrição|descrição do vendedor)$/iu.test(value);
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
