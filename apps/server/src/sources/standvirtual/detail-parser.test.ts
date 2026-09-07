import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalStandvirtualDetailUrl, parseStandvirtualDetail } from "./detail-parser.js";
const url = "https://www.standvirtual.com/carros/anuncio/golf-ID6Detail.html";
const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/standvirtual/detail/${name}.html`, import.meta.url), "utf8");
describe("Standvirtual detail contract", () => {
  it("extracts allowlisted evidence without exporting contacts, profiles, payments or scripts", () => {
    const result = parseStandvirtualDetail(fixture("valid"), url, `${url}?tracking=discard`, 2026);
    expect(result).toMatchObject({ canonicalUrl: url, description: "Revisão feita. 125 000 km.",
      structuredFacts: { make: "Volkswagen", model: "Golf", year: 2010, mileageKm: 130000, fuel: "petrol", transmission: "manual", powerHp: 122, sellerType: "dealer", imported: false },
      evidence: { warranty: "18 Meses", inspection: "2027-06", equipment: ["Bluetooth", "Ar condicionado"], importStatus: "national", postedDate: "2026-09-07T00:00:00.000Z" } });
    expect(JSON.stringify(result)).not.toMatch(/SANITIZED|900 000|tracking|profile|IBAN|financiamento|Contactar/i);
  });
  it("preserves unknowns and rejects changed, empty, blocked and login pages", () => {
    expect(parseStandvirtualDetail(fixture("partial"), url)).toMatchObject({ structuredFacts: { year: null, mileageKm: null, imported: null, sellerType: null }, evidence: { warranty: null, inspection: null, importStatus: null, equipment: [], postedDate: null } });
    for (const html of [fixture("changed"), fixture("blocked"), "", '<form><input type="password"></form>'+fixture("valid"), '<form><input type=password></form>'+fixture("valid"), '<section data-testid="content-description-section"></section>']) {
      expect(() => parseStandvirtualDetail(html, url)).toThrow();
    }
  });
  it("refuses other listing IDs, unsafe URLs and oversized pages", () => {
    for (const unsafe of [url.replace("https:", "http:"), url.replace("www.", "user@www."), url.replace(".com/", ".com:8000/"), url.replace("www.standvirtual.com", "evil.example"), "https://www.standvirtual.com/carros", "https://www.standvirtual.com/login"]) {
      expect(() => canonicalStandvirtualDetailUrl(unsafe)).toThrow();
    }
    expect(() => parseStandvirtualDetail(fixture("valid"), url, url.replace("6Detail", "6Other"))).toThrow(/selected/);
    expect(() => parseStandvirtualDetail("x".repeat(10*1024*1024+1), url)).toThrow(/10 MiB/);
  });
  it("fails closed on contradictory structured values", () => {
    expect(() => parseStandvirtualDetail(fixture("valid").replace('</section>\n<section data-testid="content-equipments-section">', '<div><div><p>Ano</p></div><div><p>2011</p></div></div></section>\n<section data-testid="content-equipments-section">'), url)).toThrow(/disagree/);
  });
});
