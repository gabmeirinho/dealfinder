import { buildComparableCohort } from "./cohort.js";
import {
  DEAL_SCORE_VERSION,
  type CalculateDealScoreInput,
  type DealScoreCalculation,
  type DealScoreComponent,
  type DealScoreConfidence
} from "./types.js";

const BASE_SCORE = 35;

export function calculateDealScore(input: CalculateDealScoreInput): DealScoreCalculation {
  validateTimestamp(input.lastSeenAt, "Last seen at");
  validateTimestamp(input.evaluatedAt, "Evaluated at");
  const cohort = buildComparableCohort(input.listingId, input.enrichment, input.marketplaceHistory);
  const price = priceComponent(input, cohort.medianPriceCents);
  const preferences = preferenceComponent(input);
  const freshness = freshnessComponent(input.lastSeenAt, input.evaluatedAt);
  const distance = distanceComponent(input);
  const completeness = completenessComponent(input);
  const risk = riskComponent(input);
  const components = [price.component, preferences, freshness, distance, completeness.component, risk];
  const rawTotal = BASE_SCORE + components.reduce((sum, component) => sum + component.points, 0);
  const highRiskPrice = input.risk.highRiskVerifyPrice;
  const total = clamp(Math.round(rawTotal), 0, highRiskPrice ? 59 : 100);
  const confidence = confidenceFor(
    cohort.members.length,
    completeness.component.points,
    highRiskPrice
  );
  return {
    cohort,
    score: {
      version: DEAL_SCORE_VERSION,
      total,
      confidence,
      marketDataStatus: cohort.marketDataStatus,
      marketDataLabel: cohort.marketDataLabel,
      medianPriceCents: cohort.medianPriceCents,
      comparableCount: cohort.members.length,
      discountPercent: price.discountPercent,
      components
    }
  };
}

function priceComponent(
  input: CalculateDealScoreInput,
  medianPriceCents: number | null
): { component: DealScoreComponent; discountPercent: number | null } {
  const price = input.enrichment.price;
  if (medianPriceCents === null || price.interpretation !== "full_price" || price.amountCents === null) {
    return {
      component: {
        key: "price_position",
        points: 0,
        explanation: "Insufficient market data; no market discount is claimed"
      },
      discountPercent: null
    };
  }
  const discount = roundOne(((medianPriceCents - price.amountCents) / medianPriceCents) * 100);
  const points = clamp(Math.round(discount), -30, 30);
  const relation = discount >= 0 ? `${discount}% below` : `${Math.abs(discount)}% above`;
  return {
    component: {
      key: "price_position",
      points,
      explanation: `Full price is ${relation} the median of ${medianPriceCents} cents`
    },
    discountPercent: discount
  };
}

function preferenceComponent(input: CalculateDealScoreInput): DealScoreComponent {
  const matched = input.softPreferences.filter(({ matched: value }) => value === true).length;
  const missed = input.softPreferences.filter(({ matched: value }) => value === false).length;
  const unknown = input.softPreferences.length - matched - missed;
  return {
    key: "preferences",
    points: clamp((matched - missed) * 2, -10, 10),
    explanation: `${matched} soft preferences matched, ${missed} missed, ${unknown} unknown`
  };
}

function freshnessComponent(lastSeenAt: string, evaluatedAt: string): DealScoreComponent {
  const ageDays = Math.max(0, (Date.parse(evaluatedAt) - Date.parse(lastSeenAt)) / 86_400_000);
  const points = ageDays <= 1 ? 10 : ageDays <= 3 ? 7 : ageDays <= 7 ? 4 : ageDays <= 30 ? 1 : 0;
  return {
    key: "freshness",
    points,
    explanation: ageDays < 1
      ? "Seen within the last day"
      : `Last seen ${Math.floor(ageDays)} days ago`
  };
}

function distanceComponent(input: CalculateDealScoreInput): DealScoreComponent {
  const distance = input.distance;
  if (distance === null || distance.status === "unknown") {
    return { key: "distance", points: 5, explanation: "Distance is unknown; neutral contribution" };
  }
  if (distance.status === "not_applicable") {
    return { key: "distance", points: 5, explanation: "Nationwide search; distance is not used" };
  }
  const kilometres = distance.approximateKilometres;
  const points = kilometres <= 25 ? 10 : kilometres <= 50 ? 8 : kilometres <= 100 ? 6 :
    kilometres <= 150 ? 4 : kilometres <= 250 ? 2 : 0;
  return {
    key: "distance",
    points,
    explanation: `Approximate straight-line distance is ${kilometres} km`
  };
}

function completenessComponent(
  input: CalculateDealScoreInput
): { component: DealScoreComponent; known: number } {
  const vehicle = input.enrichment.vehicle;
  const values = [
    vehicle.make, vehicle.model, vehicle.year, vehicle.mileageKm, vehicle.fuel,
    vehicle.transmission, vehicle.powerHp, input.enrichment.sellerType,
    input.enrichment.price.interpretation === "full_price" ? input.enrichment.price.amountCents : null
  ];
  const known = values.filter((value) => value !== null).length;
  const points = Math.round((known / values.length) * 10);
  return {
    component: {
      key: "data_completeness",
      points,
      explanation: `${known} of ${values.length} scoring facts are known`
    },
    known
  };
}

function riskComponent(input: CalculateDealScoreInput): DealScoreComponent {
  const codes = new Set(input.risk.reasons.map(({ code }) => code));
  let points = input.risk.highRiskVerifyPrice ? -30 : 0;
  if (!input.risk.highRiskVerifyPrice && codes.has("damaged_vehicle")) points -= 10;
  if (codes.has("imported_vehicle")) points -= 3;
  points = Math.max(-30, points);
  return {
    key: "risk",
    points,
    explanation: input.risk.reasons.length === 0
      ? "No configured risk indicators"
      : `Risk indicators: ${[...codes].sort().join(", ")}${input.risk.highRiskVerifyPrice ? "; confidence and score capped" : ""}`
  };
}

function confidenceFor(comparables: number, completenessPoints: number, highRisk: boolean): DealScoreConfidence {
  if (highRisk || comparables < 5 || completenessPoints < 6) return "low";
  if (comparables >= 10 && completenessPoints >= 8) return "high";
  return "medium";
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
