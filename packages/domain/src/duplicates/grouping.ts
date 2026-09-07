import { imageHashSimilarity } from "./fingerprints.js";
import type {
  DuplicateCandidateFingerprint,
  DuplicatePairEvidence,
  ProbableDuplicateGroup,
  VehicleDuplicateFingerprint
} from "./types.js";

export function groupProbableDuplicates(
  candidates: readonly DuplicateCandidateFingerprint[]
): ProbableDuplicateGroup[] {
  const sorted = [...candidates].sort((left, right) => left.listingId - right.listingId);
  const pairs: DuplicatePairEvidence[] = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const pair = comparePair(sorted[leftIndex]!, sorted[rightIndex]!);
      if (pair !== null) pairs.push(pair);
    }
  }
  const directEvidence = new Set(pairs.map((pair) => pairKey(
    pair.leftListingId,
    pair.rightListingId
  )));
  const groups = new Map(sorted.map(({ listingId }) => [listingId, new Set([listingId])]));
  const groupByListing = new Map(sorted.map(({ listingId }) => [listingId, listingId]));
  const strongestFirst = [...pairs].sort(compareEvidenceStrength);
  for (const pair of strongestFirst) {
    const leftGroupId = groupByListing.get(pair.leftListingId) as number;
    const rightGroupId = groupByListing.get(pair.rightListingId) as number;
    if (leftGroupId === rightGroupId) continue;
    const leftGroup = groups.get(leftGroupId) as Set<number>;
    const rightGroup = groups.get(rightGroupId) as Set<number>;
    // Complete-link grouping: every cross-group member must have direct evidence.
    // This prevents A≈B and B≈C from implying A≈C.
    if (![...leftGroup].every((leftId) => [...rightGroup].every((rightId) =>
      directEvidence.has(pairKey(leftId, rightId))
    ))) continue;
    const mergedId = Math.min(leftGroupId, rightGroupId);
    const removedId = Math.max(leftGroupId, rightGroupId);
    const merged = new Set([...leftGroup, ...rightGroup]);
    groups.set(mergedId, merged);
    groups.delete(removedId);
    for (const listingId of merged) groupByListing.set(listingId, mergedId);
  }
  return [...groups.values()]
    .map((members) => [...members].sort((left, right) => left - right))
    .filter((members) => members.length > 1)
    .map((members) => {
      const memberSet = new Set(members);
      const evidence = pairs.filter((pair) =>
        memberSet.has(pair.leftListingId) && memberSet.has(pair.rightListingId)
      );
      const confidence: ProbableDuplicateGroup["confidence"] =
        evidence.every((pair) => pair.confidence === "high") ? "high" : "medium";
      return {
        memberListingIds: members,
        confidence,
        pairEvidence: evidence,
        explanation: `${members.length} original listings grouped from ${evidence.length} corroborated pair${evidence.length === 1 ? "" : "s"}; no records were merged`
      };
    })
    .sort((left, right) => left.memberListingIds[0]! - right.memberListingIds[0]!);
}

function pairKey(leftId: number, rightId: number): string {
  return leftId < rightId ? `${leftId}:${rightId}` : `${rightId}:${leftId}`;
}

function compareEvidenceStrength(left: DuplicatePairEvidence, right: DuplicatePairEvidence): number {
  const confidence = Number(right.confidence === "high") - Number(left.confidence === "high");
  const image = (right.imageSimilarity ?? -1) - (left.imageSimilarity ?? -1);
  const vehicle = right.vehicleSimilarity - left.vehicleSimilarity;
  const text = right.textSimilarity - left.textSimilarity;
  return confidence || image || vehicle || text ||
    left.leftListingId - right.leftListingId || left.rightListingId - right.rightListingId;
}

function comparePair(
  left: DuplicateCandidateFingerprint,
  right: DuplicateCandidateFingerprint
): DuplicatePairEvidence | null {
  const vehicleSimilarity = compareVehicles(left.vehicle, right.vehicle);
  const textSimilarity = jaccard(left.textTokens, right.textTokens);
  const imageSimilarity = left.imageDifferenceHash === null || right.imageDifferenceHash === null
    ? null
    : imageHashSimilarity(left.imageDifferenceHash, right.imageDifferenceHash);
  const enoughText = Math.min(left.textTokens.length, right.textTokens.length) >= 5 && textSimilarity >= 0.55;
  const enoughImage = imageSimilarity !== null && imageSimilarity >= 0.82;
  const descriptionEvidence = left.hasDescription && right.hasDescription && enoughText;
  const sparseCardEvidence = (!left.hasDescription || !right.hasDescription) &&
    isStrongSparseCardMatch(left, right, textSimilarity);
  if (vehicleSimilarity < 0.65 || (!descriptionEvidence && !enoughImage && !sparseCardEvidence)) {
    return null;
  }
  const high = vehicleSimilarity >= 0.85 &&
    ((imageSimilarity !== null && imageSimilarity >= 0.9) ||
      (descriptionEvidence && textSimilarity >= 0.8) || sparseCardEvidence);
  const confidence = high ? "high" : "medium";
  return {
    leftListingId: left.listingId,
    rightListingId: right.listingId,
    confidence,
    vehicleSimilarity,
    textSimilarity,
    imageSimilarity,
    explanation: `Vehicle ${percent(vehicleSimilarity)}, text ${percent(textSimilarity)}, image ${imageSimilarity === null ? "unavailable" : percent(imageSimilarity)}; ${confidence} probable duplicate`
  };
}

function isStrongSparseCardMatch(
  left: DuplicateCandidateFingerprint,
  right: DuplicateCandidateFingerprint,
  textSimilarity: number
): boolean {
  const leftVehicle = left.vehicle;
  const rightVehicle = right.vehicle;
  if (Math.min(left.textTokens.length, right.textTokens.length) < 5 || textSimilarity < 0.8) {
    return false;
  }
  if (leftVehicle.variant === null || rightVehicle.variant === null ||
      leftVehicle.variant !== rightVehicle.variant) return false;
  if (leftVehicle.year === null || rightVehicle.year === null ||
      Math.abs(leftVehicle.year - rightVehicle.year) > 1) return false;
  if (leftVehicle.mileageKm === null || rightVehicle.mileageKm === null ||
      Math.abs(leftVehicle.mileageKm - rightVehicle.mileageKm) > 5_000) return false;
  if (leftVehicle.fuel === null || leftVehicle.fuel !== rightVehicle.fuel ||
      leftVehicle.transmission === null ||
      leftVehicle.transmission !== rightVehicle.transmission) return false;
  return similarPrice(left.priceCents, right.priceCents);
}

function similarPrice(left: number | null, right: number | null): boolean {
  if (left === null || right === null || left <= 0 || right <= 0) return false;
  return Math.abs(left - right) / Math.max(left, right) <= 0.1;
}

function compareVehicles(left: VehicleDuplicateFingerprint, right: VehicleDuplicateFingerprint): number {
  if (left.make === null || right.make === null || left.model === null || right.model === null ||
      left.make !== right.make || left.model !== right.model) return 0;
  let score = 0.45;
  if (left.variant === null || right.variant === null) score += 0.05;
  else if (left.variant === right.variant) score += 0.15;
  if (left.year !== null && right.year !== null && Math.abs(left.year - right.year) <= 1) score += 0.15;
  if (left.mileageKm !== null && right.mileageKm !== null &&
      Math.abs(left.mileageKm - right.mileageKm) <= 20_000) score += 0.1;
  if (left.fuel !== null && left.fuel === right.fuel) score += 0.075;
  if (left.transmission !== null && left.transmission === right.transmission) score += 0.075;
  return Math.round(Math.min(1, score) * 1000) / 1000;
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 0;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  return Math.round((intersection / union.size) * 1000) / 1000;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
