export const FACEBOOK_RESULTS_CONTRACT_VERSION = 1 as const;

export interface FacebookRawCandidate {
  source: "facebook";
  sourceListingId: string;
  url: string;
  title: string;
  displayedPrice: string | null;
  location: string | null;
  thumbnailUrl: string | null;
  rawCardFacts: readonly string[];
}

export interface RejectedFacebookCard {
  cardIndex: number;
  sourceListingId: string | null;
  reasons: readonly string[];
}

export interface FacebookResultPage {
  contractVersion: typeof FACEBOOK_RESULTS_CONTRACT_VERSION;
  candidates: readonly FacebookRawCandidate[];
  rejectedCards: readonly RejectedFacebookCard[];
}

export class FacebookResultContractError extends Error {
  public readonly code = "FACEBOOK_RESULT_CONTRACT_CHANGED";

  public constructor(message: string) {
    super(message);
    this.name = "FacebookResultContractError";
  }
}
