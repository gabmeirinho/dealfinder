export const POSSIBLY_UNAVAILABLE_AFTER_MISSES = 3 as const;
export const INACTIVE_AFTER_MILLISECONDS = 24 * 60 * 60 * 1000;
export const MINIMUM_ALERTABLE_PRICE_DROP_CENTS = 10_000 as const;

export type ListingAvailability = "active" | "possibly_unavailable" | "inactive" | "sold";
export type ListingDiscoveryKind = "initial_backlog" | "monitoring";
export type ListingEngagement = "new" | "shortlisted" | "contacted" | "other";
export type SoldReason = "explicit" | "user";

export interface ListingLifecycleState {
  availability: ListingAvailability;
  consecutiveMisses: number;
  firstSeenAt: string;
  lastSeenAt: string;
  possiblyUnavailableAt: string | null;
  inactiveAt: string | null;
  soldAt: string | null;
  soldReason: SoldReason | null;
}

export interface PriceChangeAssessment {
  changed: boolean;
  direction: "increase" | "decrease" | "unchanged";
  differenceCents: number;
  alertThresholdCents: number;
  meaningful: boolean;
  alertable: boolean;
}

export function createListingLifecycle(
  observedAt: string,
  explicitlySold = false
): ListingLifecycleState {
  validateTimestamp(observedAt, "Observed at");
  return {
    availability: explicitlySold ? "sold" : "active",
    consecutiveMisses: 0,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    possiblyUnavailableAt: null,
    inactiveAt: null,
    soldAt: explicitlySold ? observedAt : null,
    soldReason: explicitlySold ? "explicit" : null
  };
}

/** Observations reactivate disappeared listings, but never override a sold decision. */
export function observeListing(
  state: ListingLifecycleState,
  observedAt: string
): ListingLifecycleState {
  validateState(state);
  validateTimestamp(observedAt, "Observed at");
  if (state.availability === "sold") {
    return {
      ...state,
      firstSeenAt: earlier(state.firstSeenAt, observedAt),
      lastSeenAt: later(state.lastSeenAt, observedAt)
    };
  }
  return {
    ...state,
    availability: "active",
    consecutiveMisses: 0,
    firstSeenAt: earlier(state.firstSeenAt, observedAt),
    lastSeenAt: later(state.lastSeenAt, observedAt),
    possiblyUnavailableAt: null,
    inactiveAt: null
  };
}

export function missListing(
  state: ListingLifecycleState,
  missedAt: string
): ListingLifecycleState {
  validateState(state);
  validateTimestamp(missedAt, "Missed at");
  if (state.availability === "sold" || Date.parse(missedAt) <= Date.parse(state.lastSeenAt)) {
    return state;
  }
  const consecutiveMisses = state.consecutiveMisses + 1;
  if (consecutiveMisses < POSSIBLY_UNAVAILABLE_AFTER_MISSES) {
    return { ...state, consecutiveMisses };
  }
  return {
    ...state,
    availability: state.availability === "inactive" ? "inactive" : "possibly_unavailable",
    consecutiveMisses,
    possiblyUnavailableAt: state.possiblyUnavailableAt ?? missedAt
  };
}

export function expireListing(
  state: ListingLifecycleState,
  evaluatedAt: string
): ListingLifecycleState {
  validateState(state);
  validateTimestamp(evaluatedAt, "Evaluated at");
  if (
    state.availability === "sold" ||
    state.consecutiveMisses < POSSIBLY_UNAVAILABLE_AFTER_MISSES ||
    Date.parse(evaluatedAt) - Date.parse(state.lastSeenAt) < INACTIVE_AFTER_MILLISECONDS
  ) {
    return state;
  }
  return {
    ...state,
    availability: "inactive",
    inactiveAt: state.inactiveAt ?? evaluatedAt
  };
}

export function sellListing(
  state: ListingLifecycleState,
  soldAt: string,
  reason: SoldReason
): ListingLifecycleState {
  validateState(state);
  validateTimestamp(soldAt, "Sold at");
  return {
    ...state,
    availability: "sold",
    soldAt,
    soldReason: reason
  };
}

export function assessPriceChange(
  previousPriceCents: number,
  observedPriceCents: number,
  engagement: ListingEngagement = "new"
): PriceChangeAssessment {
  validatePrice(previousPriceCents, "Previous price");
  validatePrice(observedPriceCents, "Observed price");
  const signedDifference = observedPriceCents - previousPriceCents;
  const differenceCents = Math.abs(signedDifference);
  const alertThresholdCents = Math.max(
    MINIMUM_ALERTABLE_PRICE_DROP_CENTS,
    Math.ceil(previousPriceCents * 0.01)
  );
  const changed = signedDifference !== 0;
  const tracked = engagement === "shortlisted" || engagement === "contacted";
  const alertableDrop = signedDifference < 0 && differenceCents >= alertThresholdCents;
  return {
    changed,
    direction: signedDifference < 0 ? "decrease" : signedDifference > 0 ? "increase" : "unchanged",
    differenceCents,
    alertThresholdCents,
    meaningful: changed && (tracked || alertableDrop),
    alertable: changed && (tracked || alertableDrop)
  };
}

function validateState(state: ListingLifecycleState): void {
  validateTimestamp(state.firstSeenAt, "First seen at");
  validateTimestamp(state.lastSeenAt, "Last seen at");
  if (!Number.isSafeInteger(state.consecutiveMisses) || state.consecutiveMisses < 0) {
    throw new Error("Consecutive misses must be a non-negative integer");
  }
}

function validateTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function validatePrice(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of cents`);
  }
}

function earlier(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function later(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
