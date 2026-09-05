import { useState, type ReactElement } from "react";
import type { MarketValueAssessment, PersonalFitAssessment } from "@dealfinder/domain";
import type { ListingDetail } from "../../lib/api/listings.js";

export function marketLabel(market: MarketValueAssessment | undefined): string {
  if (market === undefined) return "Market value not assessed";
  if (market.status === "verify_price") return "Verify asking price";
  if (market.status === "insufficient_data") return "Insufficient market data";
  const discount = market.discountPercent;
  return discount === null ? "Market value not assessed" : discount === 0 ? "At the comparable median" :
    `${Math.abs(discount)}% ${discount > 0 ? "below" : "above"} comparable median`;
}

export function fitLabel(fit: PersonalFitAssessment | undefined): string {
  if (fit === undefined) return "not assessed";
  if (fit.status === "no_preferences") return "no preferences set";
  if (fit.percent === null) return "needs information";
  return `${fit.percent}%${fit.status === "partial" ? " of known preferences" : " matched"}`;
}

export function DealAssessment({ listing }: { listing: Pick<ListingDetail, "scores" | "matchStatus"> }): ReactElement {
  const [searchId, setSearchId] = useState(listing.scores[0]?.searchId ?? "");
  const selected = listing.scores.find((item) => item.searchId === searchId) ?? listing.scores[0];
  if (selected === undefined) return (
    <section className="assessment-detail" aria-label="Deal assessment">
      <h3>Deal assessment</h3>
      <p className="muted-copy">{listing.matchStatus === "needs_information"
        ? "Required vehicle facts are still missing. Capture Facebook details or correct a fact to help resolve them."
        : listing.matchStatus === "excluded" ? "This listing does not meet the required search criteria."
        : "Waiting for enrichment of the current vehicle facts."}</p>
      <dl className="assessment-pending">
        <div><dt>Market value</dt><dd>Not assessed</dd></div>
        <div><dt>Personal fit</dt><dd>Not assessed</dd></div>
        <div><dt>Valuation confidence</dt><dd>Not assessed</dd></div>
      </dl>
    </section>
  );
  const { marketValue: market, personalFit: fit, confidence } = selected.score;
  return (
    <section className="assessment-detail" aria-label="Deal assessment">
      <h3>Deal assessment</h3>
      {listing.scores.length > 1 ? <label className="assessment-search"><span>Assess for search</span>
        <select value={selected.searchId} onChange={(event) => setSearchId(event.target.value)}>
          {listing.scores.map((item) => <option key={item.searchId} value={item.searchId}>{item.searchName}</option>)}
        </select>
      </label> : <p className="muted-copy">For {selected.searchName}</p>}

      <div className="assessment-section">
        <h4>Market value</h4>
        <p className={`assessment-verdict ${market.status === "available" ? "" : "is-uncertain"}`}>
          {marketLabel(market)}
        </p>
        {market.askingPriceRange !== null ? <dl className="assessment-facts">
          <div><dt>Comparable asking-price range</dt><dd>{eur(market.askingPriceRange.lowerCents)}–{eur(market.askingPriceRange.upperCents)}</dd></div>
          <div><dt>Median asking price</dt><dd>{eur(market.medianPriceCents!)}</dd></div>
          <div><dt>Comparable vehicles</dt><dd>{market.comparableCount}</dd></div>
        </dl> : <p className="muted-copy">{market.comparableCount} comparable vehicles · At least 5 needed</p>}
        {market.status !== "insufficient_data" ? <p className="assessment-explanation">{market.explanation}</p> : null}
        {market.status === "verify_price" && market.askingPriceRange !== null ?
          <p className="muted-copy">The reference range covers the middle 50% of comparable asking prices; it is not a sale-price prediction.</p> : null}
      </div>

      <div className="assessment-section">
        <h4>Personal fit</h4>
        <p className="assessment-verdict">{fitLabel(fit).replace(/^./, (letter) => letter.toUpperCase())}</p>
        {fit.status !== "no_preferences" ? <p className="assessment-explanation">{fit.explanation}</p> : null}
        {fit.preferences.length > 0 ? <ul className="preference-evidence">
          {fit.preferences.map((preference, index) => <li key={`${preference.criterion}-${index}`}>
            <span>{criterionLabel(preference.criterion)}</span>
            <strong>{preference.matched === null ? "Unknown" : preference.matched ? "Matched" : "Missed"}</strong>
            <small>{preference.explanation}</small>
          </li>)}
        </ul> : <p className="muted-copy">Set soft preferences in your saved search to assess personal fit.</p>}
        <p className="muted-copy">{fit.distance?.label ?? "Distance unknown"}</p>
      </div>

      <div className="assessment-section">
        <h4>Valuation confidence</h4>
        <p className="assessment-verdict">{confidence.level[0]!.toUpperCase() + confidence.level.slice(1)} confidence</p>
        <p className="assessment-explanation">{confidence.knownFactCount} of {confidence.totalFactCount} facts known · {confidence.recentComparableCount} recent comparables</p>
        <details className="confidence-evidence"><summary>Why this confidence?</summary>
          <ul>{confidence.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <p className="muted-copy">This is an evidence rating, not a probability or a guarantee of vehicle condition.</p>
        </details>
      </div>
    </section>
  );
}

function eur(cents: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
}

function criterionLabel(criterion: string): string {
  const labels: Record<string, string> = {
    makeKeywords: "Make", modelKeywords: "Model", variantKeywords: "Variant", priceRange: "Budget",
    minimumYear: "Year", maximumMileageKm: "Mileage", fuels: "Fuel", transmissions: "Transmission",
    minimumPowerHp: "Power", sellerPreference: "Seller type", requiredKeywords: "Required keywords",
    excludedKeywords: "Excluded keywords"
  };
  return labels[criterion] ?? criterion;
}
