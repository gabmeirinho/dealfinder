import { describe, expect, it } from "vitest";
import { createVehicleSearchDraft, validateVehicleSearch } from "./index.js";
import { normalizeVehicleFacts } from "../normalization/normalize.js";
import { evaluateVehicleMatch } from "../normalization/matching.js";

describe("explicit model identity", () => {
  it.each([
    ["VW", "Golf", "Volkswagen Golf 2019", "matches"],
    ["SEAT", "Leon", "Seat León 2020", "matches"],
    ["Audi", "A1", "Audi A180 2020", "excluded"],
    ["Audi", "A1", "BMW A1 2020", "excluded"],
    ["Audi", "A1", "Audi", "needs_information"],
    ["Tesla", "Model 3", "Tesla Model 3 Long Range 2021", "matches"],
    ["Tesla", "Model 3", "Tesla Model Y 2021", "excluded"],
    ["Hyundai", "Santa Fe", "Hyundai Santa Fe 2020", "matches"],
    ["Hyundai", "Santa Fe", "Hyundai Santa", "needs_information"]
  ])("matches %s %s against %s", (make, model, title, status) => {
    const criteria = { ...createVehicleSearchDraft("").criteria, modelTarget: { strength: "hard" as const, value: { make, model, variant: null } } };
    const facts = normalizeVehicleFacts({ title, description: null, displayedPrice: null, cardFacts: [], referenceYear: 2026 });
    expect(evaluateVehicleMatch(facts, criteria).status).toBe(status);
  });
  it("rejects combined alternatives and conflicting identity rules", () => {
    const draft = createVehicleSearchDraft("Models");
    draft.criteria.modelTarget = { strength: "hard", value: { make: "VW", model: "Golf, Polo", variant: null } };
    expect(validateVehicleSearch(draft).success).toBe(false);
    draft.criteria.modelTarget.value.model = "Golf";
    expect(validateVehicleSearch(draft).success).toBe(true);
    draft.criteria.makeKeywords = { strength: "hard", value: ["Audi"] };
    expect(validateVehicleSearch(draft).success).toBe(false);
  });
});
