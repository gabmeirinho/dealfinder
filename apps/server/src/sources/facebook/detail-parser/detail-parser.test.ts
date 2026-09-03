import { describe, expect, it } from "vitest";

import { FacebookDetailContractError, parseFacebookListingDetail } from "./index.js";

describe("Facebook listing detail parser", () => {
  it("extracts a labelled description", () => {
    expect(parseFacebookListingDetail(`
      <main>
        <section data-testid="marketplace-item-description">
          Particular, caixa manual, histórico de manutenção completo.
        </section>
      </main>
    `)).toEqual({
      contractVersion: 1,
      description: "Particular, caixa manual, histórico de manutenção completo."
    });
  });

  it("accepts Facebook's message preview description marker", () => {
    expect(parseFacebookListingDetail(
      `<div data-ad-preview="message">One owner, serviced regularly.</div>`
    ).description).toBe("One owner, serviced regularly.");
  });

  it("extracts the content that follows Facebook's localized seller heading", () => {
    expect(parseFacebookListingDetail(`
      <section>
        <div><h2>Descrição do vendedor</h2></div>
        <div>One owner, serviced regularly, with maintenance history.</div>
      </section>
    `).description).toBe("One owner, serviced regularly, with maintenance history.");
  });

  it("does not mistake a neighboring recommendations section for the description", () => {
    expect(parseFacebookListingDetail(`
      <main>
        <section>
          <div>
            <div><h2>Description</h2></div>
            <div>The actual listing description.</div>
          </div>
          <div>Recommended listings with unrelated copy.</div>
        </section>
      </main>
    `).description).toBe("The actual listing description.");
  });

  it("strips Facebook location chrome nested beside the description text", () => {
    expect(parseFacebookListingDetail(`
      <section>
        <div><h2>Descrição do vendedor</h2></div>
        <div>
          <div>The actual listing description.</div>
          <div>Oeiras, Lisboa A localização é aproximada</div>
        </div>
      </section>
    `).description).toBe("The actual listing description.");
  });

  it("extracts the allowlisted vehicle facts from Facebook structured data", () => {
    const detail = parseFacebookListingDetail(`
      <section data-testid="marketplace-item-description">Seller did not include mileage.</section>
      <script>
        {"custom_title":"2009 Volkswagen Golf","vehicle_condition":"GOOD",
         "condition":"USED","vehicle_make_display_name":"Volkswagen",
         "vehicle_model_display_name":"golf vi 2.0tdi 110cv",
         "vehicle_fuel_type":"DIESEL",
         "vehicle_transmission_type":"MANUAL",
         "vehicle_odometer_data":{"unit":"KILOMETERS","value":297000}}
      </script>
    `);
    expect(detail.structuredFacts).toMatchObject({
      year: null,
      mileageKm: 297_000,
      make: "Volkswagen",
      model: "golf",
      variant: "vi 2.0tdi 110cv",
      fuel: "diesel",
      transmission: "manual",
      condition: "GOOD",
      listingCondition: null
    });
  });

  it("fails closed when the description is missing or contains contact data", () => {
    expect(() => parseFacebookListingDetail("<main><p>Vehicle details</p></main>"))
      .toThrow(FacebookDetailContractError);
    expect(() => parseFacebookListingDetail(
      `<div data-testid="marketplace-item-description">Call +351 912 345 678</div>`
    )).toThrow("Seller identity or contact data is not accepted");
  });
});
