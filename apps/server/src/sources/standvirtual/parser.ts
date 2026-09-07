import { parse } from "parse5";
import { normalizeVehicleFacts } from "@dealfinder/domain";

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
    seen.add(link.id);
    const priceNode = all(card, (n) => attr(n, "data-testid") === "ad-price")[0]
      ?? all(card, (n) => n.tagName === "h3" && /^[\d\s.,]+(?:\s*(?:EUR|€))?$/u.test(text(n)))[0];
    const rawPrice = priceNode ? text(priceNode) : null;
    // Only accept an explicitly EUR-denominated price; never infer currency or monthly payments.
    const hasEuro = all(card, (n) => /^(?:EUR|€)$/u.test(text(n))).length > 0;
    const displayedPrice = rawPrice && (/EUR|€/u.test(rawPrice) || hasEuro)
      ? rawPrice.replace(/EUR/gu, "€") + (/EUR|€/u.test(rawPrice) ? "" : " €") : null;
    const cardFacts = all(card, (n) => ["mileage", "fuel_type", "gearbox", "first_registration_year"]
      .includes(attr(n, "data-parameter"))).map(text).filter(Boolean);
    const facts = normalizeVehicleFacts({ title, displayedPrice, description: null, cardFacts, referenceYear });
    const missingFields = (["priceCents", "make", "model", "year", "mileageKm", "fuel", "transmission"] as const)
      .filter((key) => facts[key] === null);
    listings.push({ source: "standvirtual" as const, sourceListingId: link.id, canonicalUrl: link.url, facts, missingFields });
    if (listings.length >= limit) break;
  }
  if (listings.length === 0) {
    throw new Error("No recognized Standvirtual listings. The page may be empty, blocked, or use an unsupported layout.");
  }
  return {
    source: "standvirtual" as const,
    parserVersion: 1,
    scope: "single_page" as const,
    recognizedCards: cards.length,
    rejectedCards,
    duplicateCards,
    limitReached: listings.length === limit,
    listings
  };
}
