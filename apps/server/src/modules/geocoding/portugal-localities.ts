import type { Coordinates, LocalityKey } from "@dealfinder/domain";

import type { GeocodingProvider, GeocodingProviderMetadata } from "./provider.js";

export const PORTUGAL_LOCALITY_PROVIDER: GeocodingProviderMetadata = {
  id: "dealfinder-portugal-localities-v1",
  attribution: "Bundled offline Portuguese locality centroids",
  rateLimitPolicy: "No network requests; no rate limit applies"
};

const CENTROIDS: Readonly<Record<string, Coordinates>> = {
  lisboa: { latitude: 38.7223, longitude: -9.1393 },
  porto: { latitude: 41.1579, longitude: -8.6291 },
  setubal: { latitude: 38.5244, longitude: -8.8882 },
  sintra: { latitude: 38.8029, longitude: -9.3817 },
  cascais: { latitude: 38.6968, longitude: -9.4215 },
  almada: { latitude: 38.6765, longitude: -9.1651 },
  amadora: { latitude: 38.7538, longitude: -9.2308 },
  oeiras: { latitude: 38.6979, longitude: -9.3017 },
  loures: { latitude: 38.8309, longitude: -9.1685 },
  mafra: { latitude: 38.9379, longitude: -9.3276 },
  braga: { latitude: 41.5454, longitude: -8.4265 },
  coimbra: { latitude: 40.2033, longitude: -8.4103 },
  aveiro: { latitude: 40.6405, longitude: -8.6538 },
  leiria: { latitude: 39.7436, longitude: -8.8071 },
  santarem: { latitude: 39.2369, longitude: -8.6850 },
  evora: { latitude: 38.5714, longitude: -7.9135 },
  faro: { latitude: 37.0194, longitude: -7.9304 }
};

/** Small bundled provider intended for local, low-volume Portuguese searches. */
export class PortugalLocalityProvider implements GeocodingProvider {
  public readonly metadata = PORTUGAL_LOCALITY_PROVIDER;

  public async geocode(locality: LocalityKey): Promise<Coordinates | null> {
    return CENTROIDS[locality.cacheKey] ?? null;
  }
}
