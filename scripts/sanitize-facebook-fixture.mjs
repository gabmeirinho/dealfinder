import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "parse5";

const PRICE_PATTERN = /^(?:€\s*[\d., ]+|[\d., ]+\s*€|free|grátis|gratuito|contact seller|contactar vendedor|preço sob consulta)$/iu;
const [, , inputArgument, outputArgument] = process.argv;
if (!inputArgument || !outputArgument) {
  fail("Usage: npm run fixtures:sanitize -- <captured.html> <sanitized.html>");
}

const input = resolve(inputArgument);
const output = resolve(outputArgument);
if (input === output) fail("Input and output must be different files");

const document = parse(readFileSync(input, "utf8"));
const anchors = findAll(document, (node) => node.tagName === "a")
  .map((node) => ({ node, listing: parseListingUrl(attribute(node, "href")) }))
  .filter((entry) => entry.listing !== null);
const seen = new Set();
const cards = [];

for (const { node, listing } of anchors) {
  if (seen.has(listing.id)) continue;
  seen.add(listing.id);
  const container = closestCard(node) ?? node.parentNode ?? node;
  const texts = unique(leafTexts(container)).filter(isUsefulText);
  const price = texts.find((text) => PRICE_PATTERN.test(text)) ?? null;
  const title = texts.find((text) => text !== price) ?? "REVIEW REQUIRED";
  const location = texts.find((text) => text !== price && text !== title) ?? null;
  const facts = texts.filter((text) => text !== price && text !== title && text !== location);
  cards.push({ id: listing.id, price, title, location, facts });
}

if (cards.length === 0) fail("No Facebook Marketplace item links were found");

const outputHtml = `<!-- dealfinder-fixture: facebook-results; contract: 1; captured: sanitized; reviewed: pending -->
<!doctype html>
<html lang="und"><body><main data-dealfinder-results-contract="1">
${cards.map((card, index) => renderCard(card, index)).join("\n")}
</main></body></html>
`;
writeFileSync(output, outputHtml, { encoding: "utf8", flag: "wx" });
process.stdout.write(
  `Wrote ${cards.length} sanitized card(s) to ${output}.\n` +
  "Manually verify field labels and privacy, replace 'reviewed: pending' with the review date, then run npm run fixtures:check.\n"
);

function renderCard(card, index) {
  const field = (name, value) => value === null
    ? ""
    : `\n      <span data-dealfinder-field="${name}">${escapeHtml(value)}</span>`;
  return `  <article data-testid="marketplace-item-card">
    <a href="https://www.facebook.com/marketplace/item/${card.id}/">
      <img src="https://example.invalid/vehicle-thumbnail-${index + 1}.jpg" alt="Vehicle thumbnail">${field("price", card.price)}${field("title", card.title)}${field("location", card.location)}${card.facts.map((fact) => field("fact", fact)).join("")}
    </a>
  </article>`;
}

function closestCard(node) {
  let current = node.parentNode;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentNode) {
    if (
      current.tagName === "article" ||
      attribute(current, "role") === "article" ||
      attribute(current, "data-testid")?.includes("marketplace")
    ) return current;
  }
  return null;
}

function parseListingUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.facebook.com");
    const match = url.pathname.match(/^\/marketplace\/(?:shops\/)?item\/(\d+)(?:\/|$)/u);
    return match?.[1] ? { id: match[1] } : null;
  } catch {
    return null;
  }
}

function leafTexts(node) {
  if (node.nodeName === "#text") {
    const value = (node.value ?? "").replace(/\s+/gu, " ").trim();
    return value ? [value] : [];
  }
  if (["script", "style", "svg", "button"].includes(node.tagName)) return [];
  return (node.childNodes ?? []).flatMap(leafTexts);
}

function isUsefulText(value) {
  return value.length <= 1000 && !/^(?:save|saved|share|guardar|partilhar)$/iu.test(value);
}

function findAll(node, predicate) {
  return (predicate(node) ? [node] : []).concat(
    (node.childNodes ?? []).flatMap((child) => findAll(child, predicate))
  );
}

function attribute(node, name) {
  return node.attrs?.find((candidate) => candidate.name === name)?.value ?? null;
}

function unique(values) {
  return [...new Set(values)];
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
