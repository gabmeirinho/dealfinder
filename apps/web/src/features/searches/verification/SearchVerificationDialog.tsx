import { useRef, type ReactElement } from "react";

import type {
  ManagedVehicleSearch,
  SearchVerificationPreview
} from "@dealfinder/domain";

import { useModalFocus } from "../../../lib/modal-focus.js";

export interface SearchVerificationDialogProps {
  search: ManagedVehicleSearch;
  preview: SearchVerificationPreview;
  pending: boolean;
  error: string | null;
  onConfirm(): void;
  onReject(): void;
}

const SUPPORTED_LABELS: Readonly<Record<string, string>> = {
  "criteria.makeKeywords": "Make keywords",
  "criteria.modelKeywords": "Model keywords",
  "criteria.variantKeywords": "Variant keywords",
  "criteria.requiredKeywords": "Required keywords",
  "criteria.priceRange": "Price range",
  "criteria.minimumYear": "Minimum year",
  "criteria.maximumMileageKm": "Maximum mileage"
};

export function SearchVerificationDialog({
  search,
  preview,
  pending,
  error,
  onConfirm,
  onReject
}: SearchVerificationDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, true, { initialFocus: "container" });

  return (
    <div className="verification-layer" role="presentation">
      <div
        ref={dialogRef}
        className="verification-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="verification-title"
        aria-describedby="verification-intro"
      >
        <header className="verification-header">
          <div>
            <h2 id="verification-title">Check {search.name} on Facebook</h2>
            <p>Controlled browser open</p>
          </div>
          <span className="verification-browser-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <rect x="3" y="5" width="18" height="14" />
              <path d="M3 9h18M7 7h.01M10 7h.01" />
            </svg>
          </span>
        </header>

        <div className="verification-intro">
          <p id="verification-intro">
            Inspect the results in visible Chromium. Adjust Facebook’s location or filters there if needed, then return here to confirm the page you can see.
          </p>
          <dl>
            <div><dt>Source</dt><dd>Facebook Marketplace</dd></div>
            <div><dt>URL entry</dt><dd>Captured automatically</dd></div>
          </dl>
        </div>

        <div className="verification-columns">
          <section aria-labelledby="sent-filters-title">
            <h3 id="sent-filters-title">Sent to Facebook</h3>
            <p>These criteria shaped the generated vehicle search.</p>
            <ul className="verification-filter-list is-supported">
              {preview.supportedFilters.map((filter) => {
                const presented = presentSupportedFilter(search, filter);
                return (
                  <li key={filter}>
                    <span className="filter-check" aria-hidden="true" />
                    <strong>{presented.label}</strong>
                    <span>{presented.value}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="local-filters-title">
            <h3 id="local-filters-title">Checked after collection</h3>
            <p>These stay visible here instead of being guessed into Facebook’s URL.</p>
            <ul className="verification-filter-list is-local">
              {preview.postFilters.map((filter) => (
                <li key={filter.field}>
                  <strong>{filter.label}</strong>
                  <span>{filter.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {error === null ? null : <p className="verification-error" role="alert">{error}</p>}

        <footer className="verification-actions">
          <p>Nothing is saved until you confirm.</p>
          <div>
            <button type="button" className="secondary-action" onClick={onReject} disabled={pending}>
              {pending ? "Working…" : "Reject results"}
            </button>
            <button type="button" className="primary-action" onClick={onConfirm} disabled={pending}>
              {pending ? "Confirming…" : "Confirm results"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function presentSupportedFilter(
  search: ManagedVehicleSearch,
  field: string
): { label: string; value: string } {
  const criteria = search.criteria;
  const values: Readonly<Record<string, string>> = {
    "criteria.makeKeywords": criteria.makeKeywords?.value.join(", ") ?? "—",
    "criteria.modelKeywords": criteria.modelKeywords?.value.join(", ") ?? "—",
    "criteria.variantKeywords": criteria.variantKeywords?.value.join(", ") ?? "—",
    "criteria.requiredKeywords": criteria.requiredKeywords?.value.join(", ") ?? "—",
    "criteria.priceRange": formatPriceRange(
      criteria.priceRange?.value.minimumEur ?? null,
      criteria.priceRange?.value.maximumEur ?? null
    ),
    "criteria.minimumYear": criteria.minimumYear === null
      ? "—"
      : `${criteria.minimumYear.value} or newer`,
    "criteria.maximumMileageKm": criteria.maximumMileageKm === null
      ? "—"
      : `Up to ${formatNumber(criteria.maximumMileageKm.value)} km`
  };
  return {
    label: SUPPORTED_LABELS[field] ?? field,
    value: values[field] ?? "—"
  };
}

function formatPriceRange(minimum: number | null, maximum: number | null): string {
  if (minimum !== null && maximum !== null) {
    return `€${formatNumber(minimum)}–€${formatNumber(maximum)}`;
  }
  if (minimum !== null) return `From €${formatNumber(minimum)}`;
  if (maximum !== null) return `Up to €${formatNumber(maximum)}`;
  return "—";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}
