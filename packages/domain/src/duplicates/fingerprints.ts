import type { VehicleEnrichment } from "../enrichment/index.js";
import type { VehicleDuplicateFingerprint } from "./types.js";

const STOP_WORDS = new Set([
  "a", "as", "and", "com", "da", "das", "de", "do", "dos", "e", "em", "for",
  "from", "in", "o", "of", "os", "para", "the", "um", "uma", "with", "veiculo",
  "vehicle", "carro", "car"
]);

export function createDuplicateTextTokens(text: string): string[] {
  return [...new Set(fold(text).split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) && !/^\d{1,3}$/u.test(token)))]
    .sort();
}

export function createVehicleDuplicateFingerprint(
  enrichment: VehicleEnrichment
): VehicleDuplicateFingerprint {
  return {
    make: normalize(enrichment.vehicle.make),
    model: normalize(enrichment.vehicle.model),
    variant: normalize(enrichment.vehicle.variant),
    year: enrichment.vehicle.year,
    mileageKm: enrichment.vehicle.mileageKm,
    fuel: enrichment.vehicle.fuel,
    transmission: enrichment.vehicle.transmission
  };
}

/** 64-bit difference hash from exactly 9x8 row-major greyscale pixels. */
export function createImageDifferenceHash(greyscalePixels: Uint8Array): string {
  if (greyscalePixels.length !== 72) {
    throw new Error("Image difference hash requires exactly 9x8 greyscale pixels");
  }
  let bits = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const offset = row * 9 + column;
      bits = (bits << 1n) | ((greyscalePixels[offset] as number) >
        (greyscalePixels[offset + 1] as number) ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function imageHashSimilarity(left: string, right: string): number {
  if (!/^[0-9a-f]{16}$/u.test(left) || !/^[0-9a-f]{16}$/u.test(right)) {
    throw new Error("Image fingerprints must be 64-bit lowercase hexadecimal hashes");
  }
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let changedBits = 0;
  while (difference !== 0n) {
    changedBits += Number(difference & 1n);
    difference >>= 1n;
  }
  return Math.round((1 - changedBits / 64) * 1000) / 1000;
}

function normalize(value: string | null): string | null {
  const normalized = value === null ? "" : fold(value).replace(/[^a-z0-9]+/gu, " ").trim();
  return normalized === "" ? null : normalized;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
}
