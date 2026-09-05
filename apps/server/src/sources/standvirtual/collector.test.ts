import { describe, expect, it } from "vitest";
import { collectStandvirtualResults } from "./collector.js";

function card(id: string) {
  return `<article><h2><a href="/carros/anuncio/renault-clio-ID${id}.html">Renault Clio 1.2</a></h2>
    <h3>5 000 EUR</h3><dd data-parameter="mileage">100 000 km</dd>
    <dd data-parameter="fuel_type">Gasolina</dd><dd data-parameter="gearbox">Manual</dd>
    <dd data-parameter="first_registration_year">2010</dd></article>`;
}

describe("Standvirtual paginated collector", () => {
  it("collects newest-first pages up to 100 unique listings", async () => {
    const requested: string[] = [];
    const result = await collectStandvirtualResults("https://www.standvirtual.com/carros/renault/clio", {
      limit: 100,
      fetchHtml: async (url) => {
        requested.push(url);
        const page = Number(new URL(url).searchParams.get("page") ?? "1");
        return Array.from({ length: 40 }, (_, index) => card(`${page}${String(index).padStart(3, "0")}`)).join("");
      }
    });
    expect(result.listings).toHaveLength(100);
    expect(result).toMatchObject({ pagesScanned: 3, stopReason: "listing_limit", limitReached: true });
    expect(requested.every((url) => new URL(url).searchParams.get("search[order]") === "created_at_first:desc")).toBe(true);
    expect(new URL(requested[0]!).searchParams.has("page")).toBe(false);
    expect(new URL(requested[2]!).searchParams.get("page")).toBe("3");
  });

  it("deduplicates across pages and stops after repeated no-progress pages", async () => {
    const html = [card("Same"), card("Other")].join("");
    const result = await collectStandvirtualResults("https://www.standvirtual.com/carros/renault/clio", {
      limit: 100,
      fetchHtml: async () => html
    });
    expect(result.listings.map((listing) => listing.sourceListingId)).toEqual(["Same", "Other"]);
    expect(result).toMatchObject({ pagesScanned: 3, stopReason: "no_progress", duplicateCards: 4 });
  });

  it("retains partial results when a later request fails", async () => {
    let calls = 0;
    const result = await collectStandvirtualResults("https://www.standvirtual.com/carros/renault/clio", {
      fetchHtml: async () => {
        if (++calls === 2) throw new Error("temporary failure");
        return card("First");
      }
    });
    expect(result.listings).toHaveLength(1);
    expect(result).toMatchObject({ pagesScanned: 1, stopReason: "request_error", partialError: "temporary failure" });
  });

  it("records the end of sparse results without reporting a partial error", async () => {
    let calls = 0;
    const result = await collectStandvirtualResults("https://www.standvirtual.com/carros/peugeot/206", {
      fetchHtml: async () => ++calls === 1 ? card("Only") : "<main>No results</main>"
    });
    expect(result).toMatchObject({
      pagesScanned: 1,
      stopReason: "results_end",
      partialError: null
    });
  });

  it("rejects invalid limits and does not hide a first-page failure", async () => {
    await expect(collectStandvirtualResults("https://www.standvirtual.com/carros", { limit: 101 })).rejects.toThrow("100");
    await expect(collectStandvirtualResults("https://www.standvirtual.com/carros", {
      fetchHtml: async () => { throw new Error("blocked"); }
    })).rejects.toThrow("blocked");
  });
});
