import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStandvirtualResults, validateSearchUrl } from "./parser.js";

// Synthetic semantic markup, not a verified capture of the live layout.
function card(id = "6Example", extras = "") {
  return `<article data-testid="listing-ad">
    <h2><a href="/carros/anuncio/bmw-320-ID${id}.html?tracking=discard">BMW 320 d</a></h2>
    <h3>18 500</h3><p>EUR</p>
    <dd data-parameter="mileage">120 000 km</dd>
    <dd data-parameter="fuel_type">Diesel</dd>
    <dd data-parameter="gearbox">Automática</dd>
    <dd data-parameter="first_registration_year">2019</dd>
    <a href="https://seller.standvirtual.com">Seller identity</a>
    ${extras}
  </article>`;
}

describe("Standvirtual feasibility parser", () => {
  it("normalizes vehicle facts with the shared domain and strips tracking and seller markup", () => {
    const result = parseStandvirtualResults(card(), 20, 2026);
    expect(result.listings[0]).toMatchObject({
      source: "standvirtual", sourceListingId: "6Example",
      canonicalUrl: "https://www.standvirtual.com/carros/anuncio/bmw-320-ID6Example.html",
      facts: { priceCents: 1850000, year: 2019, mileageKm: 120000, make: "BMW",
        model: "320", fuel: "diesel", transmission: "automatic" }, missingFields: []
    });
    expect(JSON.stringify(result)).not.toContain("Seller identity");
    expect(JSON.stringify(result)).not.toContain("tracking");
  });

  it("deduplicates promoted listings and caps unique results", () => {
    const result = parseStandvirtualResults(card() + card() + card("6Other") + card("6Third"), 2);
    expect(result.listings).toHaveLength(2);
    expect(result.duplicateCards).toBe(1);
    expect(result.limitReached).toBe(true);
  });

  it("keeps unknown fields unknown", () => {
    const result = parseStandvirtualResults(`<article><h2><a href="/carros/anuncio/bmw-320-ID6Test.html">BMW 320</a></h2></article>`);
    expect(result.listings[0]?.facts.priceCents).toBeNull();
    expect(result.listings[0]?.missingFields).toContain("mileageKm");
  });

  it("does not infer asking price from monthly payments or a currency-less number", () => {
    for (const markup of [card().replace("18 500", "250 €/mês"), card().replace("<p>EUR</p>", ""), card().replace("<h3>18 500</h3>", '<h3 data-testid="ad-price">250 €/mês</h3>')]) {
      expect(parseStandvirtualResults(markup).listings[0]?.facts.priceCents).toBeNull();
    }
  });

  it("ignores scripts and rejects unrelated links, empty pages, challenges, and changed layouts", () => {
    expect(parseStandvirtualResults(card() + "<script>request blocked</script>").listings).toHaveLength(1);
    for (const html of ["", "<h1>403 ERROR</h1>" + card(), "<main>No results</main>",
      card().replace("/carros/anuncio/", "https://evil.example/carros/anuncio/"),
      card().replaceAll("article", "section")]) {
      expect(() => parseStandvirtualResults(html)).toThrow();
    }
  });

  it("reports rejected cards without exporting their text", () => {
    const result = parseStandvirtualResults(card() + "<article>Unrelated promotion</article>");
    expect(result.rejectedCards).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Unrelated promotion");
  });

  it("rejects oversized input and invalid limits", () => {
    expect(() => parseStandvirtualResults("x".repeat(10 * 1024 * 1024 + 1))).toThrow("10 MiB");
    for (const limit of [0, 51, 1.5, NaN]) expect(() => parseStandvirtualResults(card(), limit)).toThrow("Limit");
  });
});

describe("Standvirtual search URL boundary", () => {
  it("accepts public car search filters", () => {
    expect(validateSearchUrl("https://www.standvirtual.com/carros/bmw?search%5Bfilter_float_price%3Ato%5D=20000#top"))
      .toBe("https://www.standvirtual.com/carros/bmw?search%5Bfilter_float_price%3Ato%5D=20000");
  });
  it("rejects external hosts, credentials, ports, non-HTTPS and detail URLs", () => {
    for (const url of ["https://evil.example/carros", "http://www.standvirtual.com/carros",
      "https://www.standvirtual.com.evil.example/carros", "https://user@www.standvirtual.com/carros",
      "https://www.standvirtual.com:8000/carros", "https://www.standvirtual.com/carros/anuncio/test-ID6A.html",
      "https://www.standvirtual.com/carros-other", "file:///carros"]) {
      expect(() => validateSearchUrl(url)).toThrow();
    }
  });
});

describe("rich semantic card evidence", () => {
  it("retains allowlisted metadata, missing fields and safe thumbnails while skipping malformed cards", () => {
    const html = readFileSync(new URL("../../../test/fixtures/standvirtual/semantic-results.html", import.meta.url), "utf8");
    const parsed = parseStandvirtualResults(html, 20, 2026);
    expect(parsed).toMatchObject({ parserVersion: 2, rejectedCards: 2, duplicateCards: 1 });
    expect(parsed.listings).toHaveLength(2);
    expect(parsed.listings[0]).toMatchObject({
      location: "Lisboa", thumbnailUrl: "https://images.olxcdn.com/vehicle-example.jpg",
      postedAt: "2026-09-06T00:00:00.000Z", warranty: true, imported: true,
      facts: { seller: { type: "dealer" }, indicators: { imported: true },
        original: { description: "Revisão feita. Garantia de 18 meses." } }
    });
    expect(parsed.listings[1]).toMatchObject({ location: null, thumbnailUrl: null, postedAt: null,
      warranty: null, imported: null, facts: { seller: { type: null } } });
    expect(JSON.stringify(parsed)).not.toMatch(/SANITIZED SELLER|private-profile|tracking|900 000/);
  });

  it("keeps explicit negative indicators and rejects contact-bearing metadata", () => {
    const result = parseStandvirtualResults(card("6Negative", `<p data-testid="ad-location">WhatsApp +351 900 000 000</p>
      <p data-testid="ad-description">mail@example.test</p><span data-parameter="warranty">Sem garantia</span>
      <span data-parameter="imported">Não</span><img src="https://evil.example/photo.jpg">`)).listings[0];
    expect(result).toMatchObject({ location: null, thumbnailUrl: null, warranty: false, imported: false,
      facts: { original: { description: null }, indicators: { imported: false } } });
  });
});
