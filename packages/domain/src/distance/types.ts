export interface Coordinates {
  latitude: number;
  longitude: number;
}

export const APPROXIMATE_DISTANCE_DISCLOSURE =
  "Distances are approximate straight-line measurements between locality centroids, not routes or travel times." as const;
export const OFFLINE_LOCALITY_ATTRIBUTION =
  "Locality data: bundled offline Portuguese centroids." as const;

export interface LocalityKey {
  displayName: string;
  cacheKey: string;
}

export interface DistanceProviderAttribution {
  provider: string;
  attribution: string;
}

export type UnknownDistanceReason =
  | "missing_listing_locality"
  | "origin_not_found"
  | "listing_not_found"
  | "provider_error";

export type ListingDistance =
  | {
      status: "approximate";
      approximateKilometres: number;
      withinConfiguredRadius: boolean;
      method: "straight_line";
      label: string;
      reason: null;
      attribution: DistanceProviderAttribution;
    }
  | {
      status: "unknown";
      approximateKilometres: null;
      withinConfiguredRadius: null;
      method: null;
      label: "Distance unknown";
      reason: UnknownDistanceReason;
      attribution: DistanceProviderAttribution | null;
    }
  | {
      status: "not_applicable";
      approximateKilometres: null;
      withinConfiguredRadius: null;
      method: null;
      label: "Nationwide search · distance not used";
      reason: null;
      attribution: null;
    };
