export type SearchSource = "facebook";

export type FacebookPostFilterField =
  | "location"
  | "fuels"
  | "transmissions"
  | "minimumPowerHp"
  | "sellerPreference"
  | "excludedKeywords";

export interface FacebookPostFilter {
  field: FacebookPostFilterField;
  label: string;
  reason: string;
}

export interface SearchVerificationPreview {
  searchId: string;
  source: "facebook";
  state: "pending";
  generatedUrl: string;
  supportedFilters: readonly string[];
  postFilters: readonly FacebookPostFilter[];
}

export interface SearchVerificationConfirmation {
  searchId: string;
  source: "facebook";
  state: "verified";
  verifiedAt: string;
}

export interface SearchVerificationRejection {
  searchId: string;
  source: "facebook";
  state: "rejected";
}
