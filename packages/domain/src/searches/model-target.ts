import type { VehicleModelTarget } from "./types.js";

export function identityKey(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function canonicalMake(value: string): string {
  const aliases: Record<string, string> = { vw: "Volkswagen", volkswagen: "Volkswagen", seat: "SEAT", bmw: "BMW", mercedes: "Mercedes-Benz", mercedesbenz: "Mercedes-Benz", skoda: "Škoda", citroen: "Citroën" };
  return aliases[identityKey(value)] ?? value.trim();
}

export function canonicalModelTarget(target: VehicleModelTarget): VehicleModelTarget {
  return { make: canonicalMake(target.make), model: target.model.trim(), variant: target.variant?.trim() || null };
}

export function modelTargetKey(target: VehicleModelTarget): string {
  return [canonicalMake(target.make), target.model, target.variant ?? ""].map(identityKey).join(":");
}
