import { describe, expect, it } from "vitest";

import englishFixture from "../normalization/fixtures/english-financing-trap.json" with { type: "json" };
import portugueseFixture from "../normalization/fixtures/portuguese-vehicle.json" with { type: "json" };
import { normalizeVehicleFacts, type NormalizeVehicleInput } from "../normalization/index.js";
import { assessVehicleRisk } from "./risk.js";

describe("vehicle risk rules", () => {
  it("labels financing traps and suspicious displayed prices for verification", () => {
    const risk = assessVehicleRisk(normalizeVehicleFacts(englishFixture as NormalizeVehicleInput));
    expect(risk.highRiskVerifyPrice).toBe(true);
    expect(risk.reasons.map((reason) => reason.code)).toEqual([
      "financing_price",
      "monthly_payment_price",
      "deposit_price",
      "suspiciously_low_price"
    ]);
    expect(risk.reasons.every((reason) => reason.label === "HIGH RISK / VERIFY PRICE")).toBe(true);
  });

  it("reports imported and damaged indicators without inventing a condition assessment", () => {
    const facts = normalizeVehicleFacts({
      ...portugueseFixture,
      description: "Viatura importada e acidentada para peças."
    } as NormalizeVehicleInput);
    const risk = assessVehicleRisk(facts);
    expect(risk.highRiskVerifyPrice).toBe(false);
    expect(risk.reasons).toEqual([
      expect.objectContaining({ code: "damaged_vehicle", label: "VERIFY CONDITION" }),
      expect.objectContaining({ code: "imported_vehicle", label: "VERIFY IMPORT HISTORY" })
    ]);
  });
});
