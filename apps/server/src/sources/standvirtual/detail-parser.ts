import { parse } from "parse5";
import { containsSellerIdentityOrContactData, normalizeVehicleFacts, type StructuredVehicleFacts, type StandvirtualDetailEvidence } from "@dealfinder/domain";

interface Node { tagName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: Node[]; parentNode?: Node }
export class StandvirtualDetailError extends Error {
  public constructor(public readonly code: string, message: string) { super(message); this.name = "StandvirtualDetailError"; }
}
export function canonicalStandvirtualDetailUrl(input: string): string {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname !== "www.standvirtual.com" || url.username || url.password || url.port ||
      !/^\/carros\/anuncio\/[^/]+-ID[a-zA-Z0-9]+\.html$/u.test(url.pathname)) throw new Error();
    return `${url.origin}${url.pathname}`;
  } catch { throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_URL", "Use a secure Standvirtual vehicle listing URL."); }
}

export function parseStandvirtualDetail(html: string, expectedUrl: string, actualUrl = expectedUrl, referenceYear = new Date().getUTCFullYear()) {
  const canonicalUrl = canonicalStandvirtualDetailUrl(expectedUrl);
  if (canonicalStandvirtualDetailUrl(actualUrl) !== canonicalUrl) throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_REDIRECT", "Navigation left the selected Standvirtual listing.");
  if (Buffer.byteLength(html) > 10 * 1024 * 1024) throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_TOO_LARGE", "Detail page exceeds the 10 MiB limit.");
  const document = parse(html) as Node;
  if (hasPasswordField(document) || /request blocked|403 error|access denied|too many requests|verify you are human|verifique que [ée] humano|inicie sess[aã]o para continuar|log in to continue/iu.test(text(document)) ||
    all(document, n => attr(n, "type") === "password" || /captcha|challenge/iu.test(attr(n, "id"))).length) {
    throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_BLOCKED", "Standvirtual requires verification or returned a blocked page. Check the browser before retrying.");
  }
  const declaredCanonical = all(document, n => n.tagName === "link" && attr(n, "rel") === "canonical")[0];
  if (declaredCanonical && canonicalStandvirtualDetailUrl(attr(declaredCanonical, "href")) !== canonicalUrl) {
    throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_REDIRECT", "Page identity does not match the selected listing.");
  }
  const find = (id: string) => all(document, n => attr(n, "data-testid") === id)[0];
  const descriptionSection = find("content-description-section");
  const detailsSection = find("combined-details-and-equipment-section");
  if (!descriptionSection && !detailsSection) throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_LAYOUT", "Standvirtual detail layout is not recognized.");
  const values = new Map<string, string>();
  const labels: Record<string, string> = { "Marca": "make", "Modelo": "model", "Versão": "variant", "Ano": "year", "Quilómetros": "mileage", "Combustível": "fuel", "Tipo de Caixa": "transmission", "Potência": "power", "Garantia de Stand (incl. no preço)": "warranty", "Garantia": "warranty", "Inspeção válida até": "inspection", "Inspecção válida até": "inspection", "Origem": "origin", "Anunciante": "seller" };
  if (detailsSection) for (const node of all(detailsSection, n => n.tagName === "p")) {
    const key = labels[text(node)];
    if (!key) continue;
    // The live layout places the label and value in two sibling wrappers.
    const pair = node.parentNode?.parentNode;
    const paragraphs = pair ? all(pair, n => n.tagName === "p") : [];
    if (paragraphs.length !== 2 || paragraphs[0] !== node) continue;
    const value = clean(text(paragraphs[1]!), 200);
    if (!value) continue;
    if (values.has(key) && values.get(key) !== value) throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_CONFLICT", "Structured detail fields disagree; verify the page.");
    values.set(key, value);
  }
  const get = (key: string) => values.get(key) ?? null;
  const normalizedField = (key: string) => normalizeVehicleFacts({ title: "Vehicle", description: null, displayedPrice: null, cardFacts: get(key) ? [get(key)!] : [], referenceYear });
  const origin = get("origin");
  const imported = origin === null ? null : /^nacional$/iu.test(origin) ? false : /^importad[oa]$/iu.test(origin) ? true : null;
  // Inspect only exact coarse labels inside the seller area; never retain its other text or links.
  const sellerArea = walk(document, n => attr(n, "data-testid") === "content-seller-area-section")[0];
  const coarse = sellerArea && walk(sellerArea, n => ["p", "span"].includes(n.tagName ?? "") && /^(?:Profissional|Particular)$/iu.test(text(n)))[0];
  const sellerText = get("seller") ?? (find("seller-type") ? text(find("seller-type")!) : coarse ? text(coarse) : null);
  const sellerType = /^(?:profissional|dealer)$/iu.test(sellerText ?? "") ? "dealer" as const : /^(?:particular|private)$/iu.test(sellerText ?? "") ? "private" as const : null;
  const make = get("make");
  const structuredFacts: StructuredVehicleFacts = {
    make: make ? normalizeVehicleFacts({ title: `${make} ${get("model") ?? ""}`, description: null, displayedPrice: null, cardFacts: [], referenceYear }).make ?? make : null,
    model: get("model"), variant: get("variant"), year: /^\d{4}$/u.test(get("year") ?? "") ? normalizedField("year").year : null,
    mileageKm: normalizedField("mileage").mileageKm, fuel: normalizedField("fuel").fuel,
    transmission: normalizedField("transmission").transmission, powerHp: normalizedField("power").powerHp,
    sellerType, imported
  };
  const wrapper = descriptionSection && all(descriptionSection, n => attr(n, "data-testid") === "textWrapper")[0];
  const description = wrapper ? text(wrapper).split(/\n/u).map(line => clean(line, 2000)).filter(Boolean).join("\n").slice(0, 20000) || null : null;
  const equipmentSection = find("content-equipments-section");
  const equipment = equipmentSection ? [...new Set(all(equipmentSection, n => n.tagName === "p" && !all(n, c => c.tagName === "button").length)
    .map(n => clean(text(n), 200)).filter((value): value is string => value !== null))].slice(0, 100) : [];
  const time = descriptionSection && all(descriptionSection, n => n.tagName === "time")[0];
  const date = time ? attr(time, "datetime") : "";
  const publishedText = descriptionSection && all(descriptionSection, n => n.tagName === "p" && /^\d{1,2} de [\p{L}]+ de \d{4}(?: às \d{2}:\d{2})?$/iu.test(text(n)))[0];
  const postedDate = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(date) && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : publishedText ? text(publishedText) : null;
  const evidence: StandvirtualDetailEvidence = { warranty: get("warranty"), inspection: get("inspection"), equipment, importStatus: imported === null ? null : imported ? "imported" : "national", sellerType, postedDate };
  if (description === null && !Object.values(structuredFacts).some(value => value !== null) && !evidence.warranty && !evidence.inspection && equipment.length === 0) throw new StandvirtualDetailError("STANDVIRTUAL_DETAIL_LAYOUT", "No allowlisted detail evidence was found.");
  return { source: "standvirtual" as const, canonicalUrl, description, structuredFacts, evidence };
}

function attr(n: Node, name: string): string { return n.attrs?.find(a => a.name === name)?.value ?? ""; }
function ignored(n: Node): boolean { return ["script", "style", "noscript", "svg", "form", "button"].includes(n.tagName ?? "") || (attr(n, "data-testid") !== "seller-type" && /seller|contact|financing|payment/iu.test(attr(n, "data-testid"))); }
function all(n: Node, predicate: (n: Node) => boolean): Node[] { return ignored(n) ? [] : [...(predicate(n) ? [n] : []), ...(n.childNodes ?? []).flatMap(c => all(c, predicate))]; }
function text(n: Node): string {
  if (ignored(n)) return "";
  if (n.tagName === "br") return "\n";
  return (n.value ?? (n.childNodes ?? []).map(c => text(c) + (["p", "div", "li"].includes(c.tagName ?? "") ? "\n" : " ")).join("")).replace(/[^\S\n]+/gu, " ").trim();
}
function clean(value: string, maximum: number): string | null {
  const trimmed = value.replace(/\s+/gu, " ").trim();
  return !trimmed || trimmed.length > maximum || containsSellerIdentityOrContactData([trimmed]) ||
    /https?:\/\/|www\.|contact|perfil|profile|telefone|telem[oó]vel|pagamento|payment|iban|financiamento|prestaç|mensalidade|entrada|sinal|login|captcha/iu.test(trimmed) ? null : trimmed;
}

function walk(n: Node, predicate: (n: Node) => boolean): Node[] {
  if (["script", "style", "noscript", "form", "svg"].includes(n.tagName ?? "")) return [];
  return [...(predicate(n) ? [n] : []), ...(n.childNodes ?? []).flatMap(c => walk(c, predicate))];
}

function hasPasswordField(n: Node): boolean {
  if (["script", "style", "noscript"].includes(n.tagName ?? "")) return false;
  return (n.tagName === "input" && attr(n, "type").toLowerCase() === "password") || (n.childNodes ?? []).some(hasPasswordField);
}
