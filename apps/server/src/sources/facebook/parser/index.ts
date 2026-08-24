import { parse } from "parse5";

import {
  FACEBOOK_RESULTS_CONTRACT_VERSION,
  FacebookResultContractError,
  type FacebookRawCandidate,
  type FacebookResultPage,
  type RejectedFacebookCard
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

const CARD_TEST_ID = "marketplace-item-card";
const FACEBOOK_HOST = /^(?:www\.)?facebook\.com$/u;
const ITEM_PATH = /^\/marketplace\/(?:(?:shops|np)\/)?item\/(\d+)(?:\/|$)/u;
const PRICE_PATTERN = /^(?:€\s*[\d., ]+|[\d., ]+\s*€|free|grátis|gratuito|contact seller|contactar vendedor|preço sob consulta)$/iu;

/**
 * Parses the deliberately small, versioned result-card contract produced by
 * the fixture sanitizer and by the live adapter before persistence.
 */
export function parseFacebookResultPage(html: string): FacebookResultPage {
  if (html.trim() === "") {
    throw contractError("The Facebook result page was empty");
  }

  const document = parse(html) as unknown as HtmlNode;
  validateDeclaredVersion(document);
  const cards = findAll(document, isResultCard);
  if (cards.length === 0) {
    throw contractError("No recognized Marketplace result cards were found");
  }

  const candidates: FacebookRawCandidate[] = [];
  const rejectedCards: RejectedFacebookCard[] = [];
  const seenListingIds = new Set<string>();

  for (const [cardIndex, card] of cards.entries()) {
    const parsed = parseCard(card, cardIndex);
    if ("reasons" in parsed) {
      rejectedCards.push(parsed);
      continue;
    }
    if (seenListingIds.has(parsed.sourceListingId)) continue;
    seenListingIds.add(parsed.sourceListingId);
    candidates.push(parsed);
  }

  return {
    contractVersion: FACEBOOK_RESULTS_CONTRACT_VERSION,
    candidates,
    rejectedCards
  };
}

function parseCard(
  card: HtmlNode,
  cardIndex: number
): FacebookRawCandidate | RejectedFacebookCard {
  const itemLink = findAll(card, (node) => node.tagName === "a")
    .map((node) => ({ node, parsed: parseListingUrl(attribute(node, "href")) }))
    .find((entry) => entry.parsed !== null);
  const sourceListingId = itemLink?.parsed?.id ?? null;
  const cardTexts = unique(leafTexts(card));
  const displayedPrice = fieldText(card, "price") ?? inferPrice(cardTexts);
  const title = fieldText(card, "title") ?? inferTitle(cardTexts, displayedPrice);
  const reasons: string[] = [];

  if (itemLink === undefined) reasons.push("A canonical Marketplace item URL is required");
  if (title === null) reasons.push("A non-empty listing title is required");
  if (reasons.length > 0) return { cardIndex, sourceListingId, reasons };

  const location = fieldText(card, "location") ?? inferLocation(
    cardTexts,
    displayedPrice,
    title as string
  );
  const rawCardFacts = unique([
    ...fieldTexts(card, "fact"),
    ...[displayedPrice, title, location].filter((value): value is string => value !== null)
  ]);
  const thumbnailUrl = normalizeThumbnailUrl(
    findAll(card, (node) => node.tagName === "img")
      .map((node) => attribute(node, "src"))
      .find((value) => value !== null) ?? null
  );

  return {
    source: "facebook",
    sourceListingId: sourceListingId as string,
    url: itemLink?.parsed?.url as string,
    title: title as string,
    displayedPrice,
    location,
    thumbnailUrl,
    rawCardFacts
  };
}

function validateDeclaredVersion(document: HtmlNode): void {
  const roots = findAll(
    document,
    (node) => attribute(node, "data-dealfinder-results-contract") !== null
  );
  if (roots.length === 0) return;
  const version = attribute(roots[0] as HtmlNode, "data-dealfinder-results-contract");
  if (version !== String(FACEBOOK_RESULTS_CONTRACT_VERSION)) {
    throw contractError(`Unsupported Marketplace result contract version: ${version}`);
  }
}

function isResultCard(node: HtmlNode): boolean {
  return attribute(node, "data-testid") === CARD_TEST_ID ||
    attribute(node, "data-dealfinder-card") === "marketplace-item";
}

function fieldText(node: HtmlNode, field: string): string | null {
  return fieldTexts(node, field)[0] ?? null;
}

function fieldTexts(node: HtmlNode, field: string): string[] {
  return findAll(node, (candidate) => attribute(candidate, "data-dealfinder-field") === field)
    .map(textContent)
    .map(normalizeText)
    .filter((value) => value.length > 0);
}

function inferPrice(texts: readonly string[]): string | null {
  return texts.find((text) => PRICE_PATTERN.test(text)) ?? null;
}

function inferTitle(texts: readonly string[], price: string | null): string | null {
  return texts.find((text) =>
    text !== price && !/^(?:sponsored|patrocinado|save|guardar)$/iu.test(text)
  ) ?? null;
}

function inferLocation(
  texts: readonly string[],
  price: string | null,
  title: string
): string | null {
  const titleIndex = texts.indexOf(title);
  return texts.slice(Math.max(0, titleIndex + 1)).find((text) =>
    text !== price &&
    !/^(?:\d[\d., ]*\s*(?:km|mi)|diesel|petrol|gasolina|manual|automatic|automático)$/iu.test(text)
  ) ?? null;
}

function leafTexts(node: HtmlNode): string[] {
  if (node.nodeName === "#text") {
    const normalized = normalizeText(node.value ?? "");
    return normalized === "" ? [] : [normalized];
  }
  return (node.childNodes ?? []).flatMap(leafTexts);
}

function textContent(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(textContent).join(" ");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function parseListingUrl(value: string | null): { id: string; url: string } | null {
  if (value === null) return null;
  let url: URL;
  try {
    url = new URL(value, "https://www.facebook.com");
  } catch {
    return null;
  }
  const match = url.pathname.match(ITEM_PATH);
  if (url.protocol !== "https:" || !FACEBOOK_HOST.test(url.hostname) || match?.[1] === undefined) {
    return null;
  }
  return {
    id: match[1],
    url: `https://www.facebook.com/marketplace/item/${match[1]}/`
  };
}

function normalizeThumbnailUrl(value: string | null): string | null {
  if (value === null || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function attribute(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((candidate) => candidate.name === name)?.value ?? null;
}

function findAll(node: HtmlNode, predicate: (candidate: HtmlNode) => boolean): HtmlNode[] {
  const found = predicate(node) ? [node] : [];
  return found.concat((node.childNodes ?? []).flatMap((child) => findAll(child, predicate)));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function contractError(message: string): FacebookResultContractError {
  return new FacebookResultContractError(message);
}

export * from "./types.js";
