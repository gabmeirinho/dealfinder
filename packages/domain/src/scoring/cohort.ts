import { MINIMUM_COMPARABLES, type ComparableCohort, type ComparableListingInput } from "./types.js";
import type { VehicleEnrichment } from "../enrichment/index.js";

const YEAR_BAND = 2;
const MILEAGE_BAND_KM = 40_000;

export function buildComparableCohort(
  listingId: number,
  subject: VehicleEnrichment,
  history: readonly ComparableListingInput[]
): ComparableCohort {
  const vehicle = subject.vehicle;
  const criteria = {
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    yearMinimum: vehicle.year === null ? null : vehicle.year - YEAR_BAND,
    yearMaximum: vehicle.year === null ? null : vehicle.year + YEAR_BAND,
    mileageMinimumKm: vehicle.mileageKm === null ? null : Math.max(0, vehicle.mileageKm - MILEAGE_BAND_KM),
    mileageMaximumKm: vehicle.mileageKm === null ? null : vehicle.mileageKm + MILEAGE_BAND_KM,
    fuel: vehicle.fuel,
    transmission: vehicle.transmission
  };
  const canCompare = vehicle.make !== null && vehicle.model !== null && vehicle.year !== null &&
    vehicle.mileageKm !== null && vehicle.fuel !== null && vehicle.transmission !== null;
  const candidates = canCompare
    ? history.filter((candidate) => candidate.listingId !== listingId && isComparable(subject, candidate))
      .map((candidate) => ({
        listingId: candidate.listingId,
        priceCents: candidate.enrichment.price.amountCents as number
      }))
      .sort((left, right) => left.priceCents - right.priceCents || left.listingId - right.listingId)
    : [];
  const included = excludePriceOutliers(candidates);
  const includedIds = new Set(included.map(({ listingId: id }) => id));
  const excludedOutlierListingIds = candidates
    .filter(({ listingId: id }) => !includedIds.has(id))
    .map(({ listingId: id }) => id)
    .sort((left, right) => left - right);
  const sufficient = included.length >= MINIMUM_COMPARABLES;
  return {
    criteria,
    candidateCount: candidates.length,
    members: included,
    excludedOutlierListingIds,
    medianPriceCents: sufficient ? median(included.map(({ priceCents }) => priceCents)) : null,
    marketDataStatus: sufficient ? "sufficient" : "insufficient",
    marketDataLabel: sufficient ? "Market data available" : "Insufficient market data"
  };
}

function isComparable(subject: VehicleEnrichment, candidate: ComparableListingInput): boolean {
  const target = subject.vehicle;
  const other = candidate.enrichment.vehicle;
  const price = candidate.enrichment.price;
  if (candidate.highRiskVerifyPrice || price.interpretation !== "full_price" ||
      price.amountCents === null || price.amountCents < 100_000 || price.amountCents > 100_000_000) {
    return false;
  }
  if (candidate.enrichment.indicators.damaged || candidate.enrichment.indicators.financing ||
      candidate.enrichment.indicators.monthlyPayment || candidate.enrichment.indicators.deposit) {
    return false;
  }
  return fold(other.make) === fold(target.make) &&
    fold(other.model) === fold(target.model) &&
    compatibleVariant(target.variant, other.variant) &&
    other.year !== null && target.year !== null && Math.abs(other.year - target.year) <= YEAR_BAND &&
    other.mileageKm !== null && target.mileageKm !== null &&
      Math.abs(other.mileageKm - target.mileageKm) <= MILEAGE_BAND_KM &&
    other.fuel === target.fuel && other.transmission === target.transmission;
}

function compatibleVariant(left: string | null, right: string | null): boolean {
  return left === null || right === null || fold(left) === fold(right);
}

function excludePriceOutliers<T extends { priceCents: number }>(candidates: readonly T[]): T[] {
  if (candidates.length < MINIMUM_COMPARABLES) return [...candidates];
  const prices = candidates.map(({ priceCents }) => priceCents).sort((left, right) => left - right);
  const q1 = percentile(prices, 0.25);
  const q3 = percentile(prices, 0.75);
  const spread = q3 - q1;
  const centre = median(prices);
  const minimum = spread === 0 ? centre * 0.5 : q1 - spread * 1.5;
  const maximum = spread === 0 ? centre * 1.5 : q3 + spread * 1.5;
  return candidates.filter(({ priceCents }) => priceCents >= minimum && priceCents <= maximum);
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] as number;
  const upperValue = sorted[upper] as number;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

function fold(value: string | null): string | null {
  return value?.normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase("en") ?? null;
}
