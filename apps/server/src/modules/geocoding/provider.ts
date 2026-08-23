import type { Coordinates, LocalityKey } from "@dealfinder/domain";

export interface GeocodingProviderMetadata {
  id: string;
  attribution: string;
  rateLimitPolicy: string;
}

export interface GeocodingProvider {
  readonly metadata: GeocodingProviderMetadata;
  geocode(locality: LocalityKey): Promise<Coordinates | null>;
}
