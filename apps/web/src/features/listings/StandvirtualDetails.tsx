import type { ReactElement } from "react";
import type { ListingDetail } from "../../lib/api/listings.js";

export function StandvirtualDetails({ listing, busy, onCapture }: {
  listing: ListingDetail; busy: boolean; onCapture(): void;
}): ReactElement {
  const details = listing.detailFacts;
  const evidence = details?.evidence;
  const capture = listing.detailCapture;
  const stale = capture?.stale ?? !details;
  const canCapture = capture?.canCapture ?? !details;
  return <section className="source-detail-evidence" aria-label="Standvirtual detail evidence">
    <h3>Standvirtual details</h3>
    <p className="muted-copy">{details ? `Captured ${date(details.capturedAt)}${stale ? " · Stale evidence" : ""}` : "Details have not been captured. Only result-card evidence is available."}</p>
    {capture?.state === "failed" ? <p role="status">Last capture failed: {capture.lastErrorCode ?? "Unknown error"}. {capture.lastErrorCode?.includes("BLOCKED") ? "Check the browser for a verification page." : "Check that the browser is open and the listing is available."}</p> : null}
    {capture?.state === "processing" ? <p role="status">Capturing detail evidence…</p> : null}
    {stale ? <button className="secondary-action" type="button" onClick={onCapture} disabled={busy || !canCapture}>Capture Standvirtual details</button> : null}
    {!canCapture && capture?.nextAttemptAt ? <p className="muted-copy">Next capture available {date(capture.nextAttemptAt)}.</p> : null}
    <dl className="fact-table">
      <div><dt>Warranty</dt><dd>{evidence?.warranty ?? "Unknown"}</dd></div>
      <div><dt>Inspection</dt><dd>{evidence?.inspection ?? "Unknown"}</dd></div>
      <div><dt>Origin</dt><dd>{evidence?.importStatus === "national" ? "National" : evidence?.importStatus === "imported" ? "Imported" : "Unknown"}</dd></div>
      <div><dt>Seller type</dt><dd>{evidence?.sellerType === "dealer" ? "Dealer" : evidence?.sellerType === "private" ? "Private" : "Unknown"}</dd></div>
      <div><dt>Posted</dt><dd>{evidence?.postedDate ? date(evidence.postedDate) : "Unknown"}</dd></div>
    </dl>
    <h4>Equipment</h4>
    {evidence?.equipment.length ? <ul>{evidence.equipment.map(item => <li key={item}>{item}</li>)}</ul> : <p className="muted-copy">No equipment evidence captured.</p>}
    {details?.conflicts.length ? <aside className="listing-risk"><strong>Facts to verify</strong><span>Structured details disagree with the card or description: {details.conflicts.map(label).join(", ")}. Structured facts are selected unless you have corrected them.</span></aside> : null}
    <h4>Result card evidence</h4>
    {listing.cardEvidence ? <p className="muted-copy">Observed {date(listing.cardEvidence.observedAt)}</p> : null}
    {listing.cardEvidence?.description ? <p>{listing.cardEvidence.description}</p> : null}
    <ul>{(listing.cardEvidence?.cardFacts ?? listing.original.cardFacts).map((fact, index) => <li key={index}>{fact}</li>)}</ul>
  </section>;
}
function date(at: string): string {
  return Number.isFinite(Date.parse(at)) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Lisbon" }).format(new Date(at)) : at;
}
function label(field: string): string { return ({ mileageKm: "mileage", powerHp: "power", sellerType: "seller type" } as Record<string, string>)[field] ?? field; }
