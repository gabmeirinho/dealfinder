import type { StructuredVehicleFacts } from "@dealfinder/domain";

export const FACEBOOK_DETAIL_CONTRACT_VERSION = 1 as const;

export interface FacebookListingStructuredFacts extends StructuredVehicleFacts {
  condition: string | null;
  listingCondition: string | null;
}

export interface FacebookListingDetail {
  contractVersion: typeof FACEBOOK_DETAIL_CONTRACT_VERSION;
  description: string;
  structuredFacts?: FacebookListingStructuredFacts;
}

export class FacebookDetailContractError extends Error {
  public readonly code = "FACEBOOK_DETAIL_CONTRACT_CHANGED";

  public constructor(message: string) {
    super(message);
    this.name = "FacebookDetailContractError";
  }
}
