import { parse } from "parse5";
import { normalizeVehicleFacts, containsSellerIdentityOrContactData } from "@dealfinder/domain";

interface Node {
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
}

const BASE = "https://www.standvirtual.com";
const MAX_HTML_BYTES = 10 * 1024 * 1024;

export function validateSearchUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname !== "www.standvirtual.com"
    || url.port || url.username || url.password
    || !/^\/carros(?:\/|$)/u.test(url.pathname) || url.pathname.includes("/anuncio/")) {
    throw new Error("Use an HTTPS results URL on www.standvirtual.com/carros.");
  }
  url.hash = "";
  return url.href;
}

function listingUrl(input: string): { id: string; url: string } | null {
  try {
    const url = new URL(input, BASE);
    const match = /^\/carros\/anuncio\/[^/]+-ID([a-zA-Z0-9]+)\.html$/u.exec(url.pathname);
    if (url.origin !== BASE || url.username || url.password || !match?.[1]) return null;
    return { id: match[1], url: `${BASE}${url.pathname}` };
  } catch { return null; }
}

function attr(node: Node, name: string): string {
  return node.attrs?.find((a) => a.name === name)?.value ?? "";
}

function all(node: Node, predicate: (node: Node) => boolean): Node[] {
  if (["script", "style", "noscript"].includes(node.tagName ?? "")) return [];
  return [...(predicate(node) ? [node] : []), ...(node.childNodes ?? []).flatMap((n) => all(n, predicate))];
}

function text(node: Node): string {
  if (["script", "style", "noscript"].includes(node.tagName ?? "")) return "";
  return (node.value ?? (node.childNodes ?? []).map(text).join(" ")).replace(/\s+/gu, " ").trim();
}

/** Experimental semantic HTML adapter; no scripts, seller profiles or contacts are exported. */
export function parseStandvirtualResults(html: string, limit = 20, referenceYear = new Date().getFullYear()) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Limit must be between 1 and 50.");
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error("HTML exceeds the 10 MiB probe limit.");
  const document = parse(html) as Node;
  const visibleText = text(document);
  if (/request blocked|403 error|verify you are human|verifique que [ée] humano|access denied|too many requests/iu.test(visibleText)) {
    throw new Error("Standvirtual returned an access challenge or blocked page; no results accepted.");
  }
  const cards = all(document, (n) => n.tagName === "article");
  const seen = new Set<string>();
  const listings = [];
  let rejectedCards = 0;
  let duplicateCards = 0;
  for (const card of cards) {
    const heading = all(card, (n) => ["h1", "h2"].includes(n.tagName ?? ""))[0];
    const link = heading && all(heading, (n) => n.tagName === "a")
      .map((n) => listingUrl(attr(n, "href"))).find((url) => url !== null);
    const title = heading ? text(heading) : "";
    if (!link || !title || title.length > 1000) { rejectedCards++; continue; }
    if (seen.has(link.id)) { duplicateCards++; continue; }

    const priceNode = all(card, (n) => attr(n, "data-testid") === "ad-price")[0]
      ?? all(card, (n) => n.tagName === "h3" && /^[\d\s.,]+(?:\s*(?:EUR|€))?$/u.test(text(n)))[0];
    const priceText = priceNode ? text(priceNode) : null;
    const rawPrice = priceText && priceText.length <= 200 ? priceText : null;
    // Only accept an explicitly EUR-denominated price; never infer currency or monthly payments.
    const hasEuro = all(card, (n) => /^(?:EUR|€)$/u.test(text(n))).length > 0;
    const displayedPrice = rawPrice && /^[\d\s.,]+(?:\s*(?:EUR|€))?$/u.test(rawPrice) && (/EUR|€/u.test(rawPrice) || hasEuro)
      ? rawPrice.replace(/EUR/gu, "€") + (/EUR|€/u.test(rawPrice) ? "" : " €") : null;
    const cardFacts = all(card, (n) => ["mileage", "fuel_type", "gearbox", "first_registration_year"]
      .includes(attr(n, "data-parameter"))).map(text).filter(Boolean);
    // Read only named vehicle fields; never flatten seller/profile containers.
    const field = (...names: string[]) => {
      const node = all(card, (n) => names.includes(attr(n, "data-testid")) || names.includes(attr(n, "data-parameter")))[0];
      const value = node ? text(node) : "";
      return value && value.length <= 500 && !/https?:\/\/|www\./iu.test(value) && !containsSellerIdentityOrContactData([value]) ? value : null;
    };
    const location = field("location", "ad-location");
    const description = field("description", "ad-description");
    const sellerText = field("seller-type", "seller_type");
    const sellerType = /^(?:profissional|dealer)$/iu.test(sellerText ?? "") ? "dealer" as const :
      /^(?:particular|private)$/iu.test(sellerText ?? "") ? "private" as const : null;
    const warrantyText = field("warranty");
    const importText = field("imported", "country_origin");
    const warranty = explicitIndicator(warrantyText, /garantia|warranty|\d+\s*(?:meses|months)/iu);
    const imported = explicitIndicator(importText, /importad[oa]|imported/iu);
    if (sellerType) cardFacts.push(sellerType === "dealer" ? "Profissional" : "Particular");
    if (warrantyText) cardFacts.push(`Warranty: ${warrantyText}`);
    if (importText) cardFacts.push(imported === true ? "Importado" : imported === false ? "Nacional" : `Origin: ${importText}`);
    const time = all(card, (n) => n.tagName === "time")[0];
    const date = time ? attr(time, "datetime") : "";
    const postedAt = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(date) && Number.isFinite(Date.parse(date))
      ? new Date(date).toISOString() : null;
    if (postedAt) cardFacts.push(`Posted: ${postedAt}`);
    const thumbnailUrl = all(card, (n) => n.tagName === "img").map((n) => safeThumbnail(attr(n, "src"))).find(Boolean) ?? null;
    let facts;
    try {
      facts = normalizeVehicleFacts({ title, displayedPrice, description, cardFacts, referenceYear, seller: { type: sellerType } });
    } catch { rejectedCards++; continue; }
    seen.add(link.id);
    const missingFields = (["priceCents", "make", "model", "year", "mileageKm", "fuel", "transmission"] as const)
      .filter((key) => facts[key] === null);
    listings.push({ source: "standvirtual" as const, sourceListingId: link.id, canonicalUrl: link.url, location, thumbnailUrl, postedAt, warranty, imported, facts, missingFields });
    if (listings.length >= limit) break;
  }
  if (listings.length === 0) {
    throw new Error("No recognized Standvirtual listings. The page may be empty, blocked, or use an unsupported layout.");
  }
  return {
    source: "standvirtual" as const,
    parserVersion: 2,
    scope: "single_page" as const,
    recognizedCards: cards.length,
    rejectedCards,
    duplicateCards,
    limitReached: listings.length === limit,
    listings
  };
}

function safeThumbnail(input: string): string | null {
  try {
    const url = new URL(input);
    if (input.length > 4096 || url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "www.standvirtual.com" || url.hostname.endsWith(".olxcdn.com"))) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return null; }
}

function explicitIndicator(value: string | null, positive: RegExp): boolean | null {
  if (value === null) return null;
  if (/^(?:n[aã]o|no|sem|without|nacional)\b/iu.test(value)) return false;
  return /^(?:sim|yes)$/iu.test(value) || positive.test(value) ? true : null;
}
