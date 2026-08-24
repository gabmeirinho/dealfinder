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
  const parent = new Map(sorted.map(({ listingId }) => [listingId, listingId]));
  const find = (id: number): number => {
    const direct = parent.get(id) as number;
    if (direct === id) return id;
    const root = find(direct);
    parent.set(id, root);
    return root;
  };
  for (const pair of pairs) {
    const leftRoot = find(pair.leftListingId);
    const rightRoot = find(pair.rightListingId);
    if (leftRoot !== rightRoot) parent.set(Math.max(leftRoot, rightRoot), Math.min(leftRoot, rightRoot));
  }
  const membersByRoot = new Map<number, number[]>();
  for (const { listingId } of sorted) {
    const root = find(listingId);
    const members = membersByRoot.get(root);
    if (members === undefined) membersByRoot.set(root, [listingId]);
    else members.push(listingId);
  }
  return [...membersByRoot.values()]
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
  if (vehicleSimilarity < 0.65 || (!enoughText && !enoughImage)) return null;
  const high = vehicleSimilarity >= 0.85 &&
    ((imageSimilarity !== null && imageSimilarity >= 0.9) || textSimilarity >= 0.8);
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
