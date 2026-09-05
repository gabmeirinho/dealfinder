export type ListingReviewState =
  | "new" | "shortlisted" | "contacted" | "viewing_arranged" | "rejected" | "bought";

export interface ListingSummary {
  id: number;
  title: string;
  sourceUrl: string | null;
  displayedPrice: string | null;
  currentPriceCents: number | null;
  availability: "active" | "possibly_unavailable" | "inactive" | "sold";
  firstSeenAt: string;
  lastSeenAt: string;
  location: string | null;
  review: {
    state: ListingReviewState;
    archived: boolean;
    rejectionReason: string | null;
    updatedAt: string;
  };
  facts: VehicleFacts | null;
  risk: RiskAssessment | null;
  score: DealScore | null;
  matchStatus?: "matches" | "excluded" | "needs_information";
  processing: { state: string; lastErrorCode: string | null } | null;
}

export interface VehicleFacts {
  original: { title: string; description: string | null; displayedPrice: string | null; cardFacts: string[] };
  priceCents: number | null;
  year: number | null;
  mileageKm: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  fuel: string | null;
  transmission: string | null;
  powerHp: number | null;
  seller: { type: string | null; rating: number | null; ratingCount: number | null; inventorySize: number | null };
  indicators: Record<string, boolean>;
}

export interface DealScore {
  total: number;
  confidence: "low" | "medium" | "high";
  marketDataLabel: string;
  medianPriceCents: number | null;
  comparableCount: number;
  discountPercent: number | null;
  components: Array<{ key: string; points: number; explanation: string }>;
}

export interface RiskAssessment {
  highRiskVerifyPrice: boolean;
  reasons: Array<{ code: string; label: string; explanation: string }>;
}

export interface ListingDetail extends ListingSummary {
  original: VehicleFacts["original"];
  normalizedFacts: VehicleFacts | null;
  effectiveFacts: VehicleFacts | null;
  detailFacts?: {
    structuredFacts: {
      year: number | null; mileageKm: number | null; make: string | null; model: string | null;
      variant: string | null; fuel: string | null; transmission: string | null; powerHp: number | null;
      condition: string | null; listingCondition: string | null;
    };
    textFacts: Omit<VehicleFacts, "original" | "priceCents" | "seller" | "indicators"> & { mileageKm: number | null };
    selectedFacts: Omit<VehicleFacts, "original" | "priceCents" | "seller" | "indicators"> & { mileageKm: number | null };
    mileage: { structuredKm: number | null; descriptionKm: number | null; cardKm: number | null; selectedKm: number | null; source: string; conflict: boolean };
    conflicts: string[];
    capturedAt: string;
  } | null;
  corrections: Array<{
    id: string; field: string; value: string | number | null; reason: string | null;
    proposal: { id: string; status: "pending" | "approved" | "rejected" } | null;
  }>;
  matches: Array<{
    searchId: string; searchName: string;
    evaluation: { eligible: boolean; status?: "matches" | "excluded" | "needs_information"; missingCriteria?: Array<{ criterion: string; explanation: string }>; hardFailures: Array<{ label?: string; explanation?: string }> } | null;
    distance: { distance: { label: string; status: string } } | null;
  }>;
  scores: Array<{ searchId: string; searchName: string; score: DealScore }>;
  priceHistory: Array<{ id: number; observedAt: string; priceCents: number; displayedPrice: string; previousPriceCents: number | null }>;
  duplicate: null | {
    confidence: string; explanation: string;
    members: Array<{ listingId: number; title: string; listingUrl: string | null }>;
  };
  notes: Array<{ id: number; body: string; createdAt: string }>;
  sellerMessage: string;
  suggestedQuestions: string[];
}

export interface ListingFilters {
  state?: ListingReviewState;
  risk?: boolean;
  archived?: boolean;
  query?: string;
}

export interface ListingApiClient {
  list(filters?: ListingFilters): Promise<ListingSummary[]>;
  get(id: number): Promise<ListingDetail>;
  setWorkflow(id: number, state: ListingReviewState, rejectionReason?: string | null): Promise<ListingDetail>;
  archive(id: number, archived: boolean): Promise<ListingDetail>;
  addNote(id: number, body: string): Promise<ListingDetail>;
  captureDescription(id: number): Promise<ListingDetail>;
  markSold(id: number): Promise<ListingDetail>;
  correct(id: number, input: { field: string; value: string | number | null; reason?: string; proposeRule?: boolean }): Promise<ListingDetail>;
  decideRule(id: string, decision: "approve" | "reject"): Promise<void>;
}

export function createListingApiClient(request: typeof fetch = fetch): ListingApiClient {
  const listingMutation = async (id: number, action: string, init: RequestInit): Promise<ListingDetail> => {
    const body = await send<{ listing: ListingDetail }>(request, `/api/listings/${id}/${action}`, init);
    return body.listing;
  };
  return {
    list: async (filters = {}) => {
      const query = new URLSearchParams();
      if (filters.state !== undefined) query.set("state", filters.state);
      if (filters.risk === true) query.set("risk", "true");
      if (filters.archived === true) query.set("archived", "true");
      if (filters.query !== undefined && filters.query !== "") query.set("q", filters.query);
      const body = await send<{ listings: ListingSummary[] }>(request, `/api/listings?${query}`);
      return body.listings;
    },
    get: async (id) => (await send<{ listing: ListingDetail }>(request, `/api/listings/${id}`)).listing,
    setWorkflow: (id, state, rejectionReason = null) => listingMutation(id, "workflow", {
      method: "PATCH", body: JSON.stringify({ state, rejectionReason })
    }),
    archive: (id, archived) => listingMutation(id, "archive", {
      method: "POST", body: JSON.stringify({ archived })
    }),
    addNote: (id, body) => listingMutation(id, "notes", {
      method: "POST", body: JSON.stringify({ body })
    }),
    captureDescription: (id) => listingMutation(id, "description", { method: "POST" }),
    markSold: (id) => listingMutation(id, "sold", { method: "POST" }),
    correct: (id, input) => listingMutation(id, "corrections", {
      method: "POST", body: JSON.stringify(input)
    }),
    decideRule: async (id, decision) => {
      await send(request, `/api/normalization-rules/${encodeURIComponent(id)}/${decision}`, { method: "POST" });
    }
  };
}

export const listingApi = createListingApiClient();

async function send<T>(request: typeof fetch, path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, {
    ...init,
    headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) }
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Listing request failed (${response.status})`);
  return body;
}
