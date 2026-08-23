import type { NormalizedVehicleFacts } from "../normalization/index.js";

export type VehicleRiskCode =
  | "financing_price"
  | "monthly_payment_price"
  | "deposit_price"
  | "suspiciously_low_price"
  | "damaged_vehicle"
  | "imported_vehicle";

export interface VehicleRiskReason {
  code: VehicleRiskCode;
  label: "HIGH RISK / VERIFY PRICE" | "VERIFY CONDITION" | "VERIFY IMPORT HISTORY";
  explanation: string;
}

export interface VehicleRiskAssessment {
  highRiskVerifyPrice: boolean;
  reasons: readonly VehicleRiskReason[];
}

export function assessVehicleRisk(facts: NormalizedVehicleFacts): VehicleRiskAssessment {
  const reasons: VehicleRiskReason[] = [];
  if (facts.indicators.financing) reasons.push(priceReason("financing_price", "Listing text mentions financing"));
  if (facts.indicators.monthlyPayment) reasons.push(priceReason("monthly_payment_price", "Displayed amount may be a monthly payment"));
  if (facts.indicators.deposit) reasons.push(priceReason("deposit_price", "Displayed amount may be a deposit or down payment"));
  if (facts.priceCents !== null && facts.priceCents > 0 && facts.priceCents < 100_000) {
    reasons.push(priceReason("suspiciously_low_price", "Vehicle price is below EUR 1,000"));
  }
  if (facts.indicators.damaged) {
    reasons.push({ code: "damaged_vehicle", label: "VERIFY CONDITION", explanation: "Listing text indicates damage or parts-only status" });
  }
  if (facts.indicators.imported) {
    reasons.push({ code: "imported_vehicle", label: "VERIFY IMPORT HISTORY", explanation: "Listing text indicates an imported vehicle" });
  }
  return {
    highRiskVerifyPrice: reasons.some((reason) => reason.label === "HIGH RISK / VERIFY PRICE"),
    reasons
  };
}

function priceReason(code: VehicleRiskCode, explanation: string): VehicleRiskReason {
  return { code, label: "HIGH RISK / VERIFY PRICE", explanation };
}
