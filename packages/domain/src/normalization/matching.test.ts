import { describe, expect, it } from "vitest";
import { createEmptySearchCriteria } from "../searches/defaults.js";
import { evaluateVehicleMatch } from "./matching.js";
import { normalizeVehicleFacts } from "./normalize.js";

const facts = normalizeVehicleFacts({
  title: "Volkswagen Golf 2020", description: null, displayedPrice: "12 500 €",
  cardFacts: [], referenceYear: 2026
});

describe("incomplete vehicle matching", () => {
  it("distinguishes unknown hard facts from confirmed mismatches", () => {
    const criteria = createEmptySearchCriteria();
    criteria.maximumMileageKm = { value: 150_000, strength: "hard" };
    criteria.fuels = { value: ["diesel"], strength: "hard" };
    expect(evaluateVehicleMatch(facts, criteria)).toMatchObject({
      status: "needs_information", eligible: false, hardFailures: [],
      missingCriteria: [
        { criterion: "maximumMileageKm", matched: null },
        { criterion: "fuels", matched: null }
      ]
    });
    expect(evaluateVehicleMatch({ ...facts, mileageKm: 200_000 }, criteria)).toMatchObject({
      status: "excluded", eligible: false,
      hardFailures: [{ criterion: "maximumMileageKm", matched: false }],
      missingCriteria: [{ criterion: "fuels", matched: null }]
    });
    expect(evaluateVehicleMatch({ ...facts, mileageKm: 100_000, fuel: "diesel" }, criteria))
      .toMatchObject({ status: "matches", eligible: true, missingCriteria: [], hardFailures: [] });
  });

  it("keeps unknown soft preferences eligible", () => {
    const criteria = createEmptySearchCriteria();
    criteria.fuels = { value: ["diesel"], strength: "soft" };
    expect(evaluateVehicleMatch(facts, criteria)).toMatchObject({
      status: "matches", eligible: true, missingCriteria: [],
      softContributions: [{ criterion: "fuels", matched: null }]
    });
  });

  it("defers absent required keywords until a description is available", () => {
    const criteria = createEmptySearchCriteria();
    criteria.requiredKeywords = { value: ["histórico"], strength: "hard" };
    expect(evaluateVehicleMatch(facts, criteria).status).toBe("needs_information");
    expect(evaluateVehicleMatch({
      ...facts, original: { ...facts.original, description: "Histórico completo" }
    }, criteria).status).toBe("matches");
    expect(evaluateVehicleMatch({
      ...facts, original: { ...facts.original, description: "Caixa manual" }
    }, criteria).status).toBe("excluded");
    criteria.excludedKeywords = { value: ["Golf"], strength: "hard" };
    expect(evaluateVehicleMatch(facts, criteria).status).toBe("excluded");
  });
});
