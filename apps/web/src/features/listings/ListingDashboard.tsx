import { DealAssessment, marketLabel, fitLabel } from "./DealAssessment.js";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";

import {
  listingApi,
  type ListingApiClient,
  type ListingDetail,
  type ListingReviewState,
  type ListingSummary,
  type ListingSort,
  type VehicleFacts
} from "../../lib/api/listings.js";

const WORKFLOW: ReadonlyArray<{ value: ListingReviewState; label: string }> = [
  { value: "new", label: "New" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "contacted", label: "Contacted" },
  { value: "viewing_arranged", label: "Viewing arranged" },
  { value: "rejected", label: "Rejected" },
  { value: "bought", label: "Bought" }
];

export interface ListingDashboardProps {
  client?: ListingApiClient;
  initialListings?: readonly ListingSummary[];
}

interface AppliedListingFilters {
  state: ListingReviewState | "all";
  query: string;
  riskOnly: boolean;
  archived: boolean;
  sort: ListingSort;
}

export function ListingDashboard({
  client = listingApi,
  initialListings
}: ListingDashboardProps): ReactElement {
  const [listings, setListings] = useState<ListingSummary[]>([...(initialListings ?? [])]);
  const [selected, setSelected] = useState<ListingDetail | null>(null);
  const [state, setState] = useState<ListingReviewState | "all">("all");
  const [query, setQuery] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const [sort, setSort] = useState<ListingSort>("recent");
  const [archived, setArchived] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<AppliedListingFilters>({
    state: "all",
    query: "",
    riskOnly: false,
    archived: false,
    sort: "recent"
  });
  const [loading, setLoading] = useState(initialListings === undefined);
  const [error, setError] = useState<string | null>(null);
  const initialFilters = useRef(appliedFilters);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const next = await client.list({
        ...(appliedFilters.state === "all" ? {} : { state: appliedFilters.state }),
        ...(appliedFilters.query === "" ? {} : { query: appliedFilters.query }),
        risk: appliedFilters.riskOnly,
        archived: appliedFilters.archived,
        ...(appliedFilters.sort === "recent" ? {} : { sort: appliedFilters.sort })
      });
      if (requestId !== latestRequest.current) return;
      setListings(next);
      setSelected((current) => current !== null && !next.some(({ id }) => id === current.id) ? null : current);
    } catch (cause: unknown) {
      if (requestId !== latestRequest.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to load the listing inbox");
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [appliedFilters, client]);

  useEffect(() => {
    if (initialListings !== undefined && appliedFilters === initialFilters.current) return;
    void load();
  }, [appliedFilters, initialListings, load]);

  const counts = useMemo(() => ({
    visible: listings.length,
    risky: listings.filter((listing) => listing.risk?.reasons.length).length,
    fresh: listings.filter((listing) => listing.review.state === "new").length
  }), [listings]);

  const open = async (id: number): Promise<void> => {
    setError(null);
    try { setSelected(await client.get(id)); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Unable to open listing"); }
  };

  const acceptDetail = (detail: ListingDetail): void => {
    setSelected(detail);
    setListings((current) => current.map((item) => item.id === detail.id ? detail : item));
  };

  return (
    <section className="listing-review" aria-labelledby="inbox-title">
      <header className="listing-heading">
        <div>
          <h1 id="inbox-title">Listing inbox</h1>
          <p>Compare market value, personal fit, and confidence, then decide which cars to pursue.</p>
        </div>
        <dl className="inbox-register" aria-label="Current inbox summary">
          <div><dt>Visible</dt><dd>{counts.visible}</dd></div>
          <div><dt>New</dt><dd>{counts.fresh}</dd></div>
          <div><dt>Risk flags</dt><dd>{counts.risky}</dd></div>
        </dl>
      </header>

      <form className="listing-filters" onSubmit={(event) => {
        event.preventDefault();
        setAppliedFilters({ state, query: query.trim(), riskOnly, archived, sort });
      }}>
        <label><span>Find a car</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Make, model, or listing text" /></label>
        <label><span>Workflow</span><select value={state} onChange={(event) => setState(event.target.value as ListingReviewState | "all")}><option value="all">All active states</option>{WORKFLOW.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="review-check"><input type="checkbox" checked={riskOnly} onChange={(event) => setRiskOnly(event.target.checked)} /><span>High-risk only</span></label>
        <label className="review-check"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /><span>Archived</span></label>
        <label><span>Sort listings</span><select value={sort} onChange={(event) => setSort(event.target.value as ListingSort)}><option value="recent">Recently seen</option><option value="market_value">Market discount</option><option value="personal_fit">Personal fit</option><option value="confidence">Valuation confidence</option></select></label>
        <button className="primary-action" type="submit">Apply filters</button>
      </form>

      {error !== null ? <p className="review-error" role="alert">{error} <button type="button" onClick={() => void load()}>Try again</button></p> : null}
      {loading ? <p className="review-loading" aria-live="polite"><span />Loading reviewed listings</p> : null}
      {!loading && listings.length === 0 ? <div className="review-empty"><h2>No cars in this view</h2><p>Adjust the workflow or archive filters. New processed matches will appear here after a scan.</p></div> : null}

      <div className={`review-ledger ${selected === null ? "is-list" : "has-detail"}`}>
        <ol className="listing-inbox" aria-label="Listings">
          {listings.map((listing) => <ListingRow key={listing.id} listing={listing} active={selected?.id === listing.id} onOpen={() => void open(listing.id)} />)}
        </ol>
        {selected !== null ? <ListingInspector key={selected.id} listing={selected} client={client} onChange={acceptDetail} onClose={() => setSelected(null)} onError={setError} /> : <aside className="review-prompt"><h2>Choose a listing</h2><p>Open one record to compare original and corrected facts, inspect the score, and move it through your buying workflow.</p></aside>}
      </div>
    </section>
  );
}

function ListingRow({ listing, active, onOpen }: { listing: ListingSummary; active: boolean; onOpen(): void }): ReactElement {
  const identity = [listing.facts?.year, listing.facts?.make, listing.facts?.model, listing.facts?.variant].filter(Boolean).join(" ");
  return (
    <li className={`listing-inbox-row ${active ? "is-selected" : ""} ${listing.risk?.reasons.length ? "is-risk" : ""}`}>
      <button type="button" onClick={onOpen} aria-label={`Review ${listing.title}`}>
        <span className="listing-score">{listing.score?.marketValue.discountPercent == null ? "—" : `${Math.abs(listing.score.marketValue.discountPercent)}%`}<small>{listing.score?.marketValue.discountPercent == null ? "market" : listing.score.marketValue.discountPercent >= 0 ? "below median" : "above median"}</small></span>
        <span className="listing-row-main"><strong>{identity || listing.title}</strong><span>{listing.displayedPrice ?? "Price unknown"} · {listing.location ?? "Location unknown"}</span><small>Seen {formatDate(listing.lastSeenAt)} · {listing.matchStatus === "needs_information" ? "Needs more information" : listing.processing?.state ?? "not processed"}</small><span className="listing-assessment-summary">{marketLabel(listing.score?.marketValue)}<br />Personal fit: {fitLabel(listing.score?.personalFit)} · Confidence: {listing.score?.confidence.level ?? "not assessed"}</span>{listing.assessmentSearchName ? <small>For {listing.assessmentSearchName}</small> : null}</span>
        <span className={`workflow-badge state-${listing.review.state}`}>{labelState(listing.review.state)}</span>
        {listing.risk?.reasons.length ? <span className="risk-stamp">{listing.risk.reasons[0]?.label}</span> : null}
      </button>
    </li>
  );
}

function ListingInspector({ listing, client, onChange, onClose, onError }: {
  listing: ListingDetail; client: ListingApiClient; onChange(detail: ListingDetail): void; onClose(): void; onError(message: string): void;
}): ReactElement {
  const [note, setNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState(listing.review.rejectionReason ?? "");
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState("Copy message");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const mileageSources = listing.detailFacts?.mileage;

  const mutate = async (operation: () => Promise<ListingDetail>): Promise<void> => {
    setBusy(true);
    try { onChange(await operation()); }
    catch (cause: unknown) { onError(cause instanceof Error ? cause.message : "Listing update failed"); }
    finally { setBusy(false); }
  };
  const setWorkflow = (next: ListingReviewState): void => {
    if (next === "rejected" && rejectionReason.trim() === "") {
      onError("Add a rejection reason before rejecting this listing.");
      return;
    }
    void mutate(() => client.setWorkflow(listing.id, next, next === "rejected" ? rejectionReason : null));
  };
  const addNote = (event: FormEvent): void => {
    event.preventDefault();
    if (note.trim() === "") return;
    void mutate(async () => { const detail = await client.addNote(listing.id, note); setNote(""); return detail; });
  };
  const copyMessage = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(listing.sellerMessage); setCopyState("Copied — send manually"); }
    catch { onError("Clipboard access failed. Select and copy the draft manually."); }
  };

  return (
    <article className="listing-inspector" aria-labelledby="listing-detail-title">
      <header className="inspector-header"><div><span className={`workflow-badge state-${listing.review.state}`}>{labelState(listing.review.state)}</span><h2 id="listing-detail-title">{listing.title}</h2><p>{listing.displayedPrice ?? "Price unknown"} · {listing.location ?? "Location unknown"}</p></div><button className="secondary-action" type="button" onClick={onClose}>Close</button></header>

      {listing.risk?.reasons.map((risk) => <aside className="listing-risk" key={risk.code}><strong>{risk.label}</strong><span>{risk.explanation}</span></aside>)}

      <section className="workflow-control"><h3>Buying workflow</h3><div className="workflow-actions">{WORKFLOW.map((item) => <button type="button" disabled={busy || item.value === listing.review.state} onClick={() => setWorkflow(item.value)} key={item.value}>{item.label}</button>)}</div><label><span>Rejection reason</span><input value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Required when rejecting" maxLength={1000} /></label><div className="workflow-secondary"><button type="button" disabled={busy} onClick={() => void mutate(() => client.archive(listing.id, !listing.review.archived))}>{listing.review.archived ? "Restore to inbox" : "Not interested / archive"}</button><button type="button" disabled={busy || listing.availability === "sold"} onClick={() => void mutate(() => client.markSold(listing.id))}>Mark source listing sold</button></div></section>

      <section className="fact-comparison"><header><h3>Vehicle facts</h3><button className="text-action" type="button" onClick={() => setCorrectionOpen((open) => !open)}>{correctionOpen ? "Close correction" : "Correct a fact"}</button></header>{mileageSources?.conflict ? <aside className="listing-risk"><strong>Mileage conflict</strong><span>Facebook structured data says {formatMileage(mileageSources.structuredKm)}; {mileageSources.descriptionKm === null ? "the result card" : "the seller description"} says {formatMileage(mileageSources.descriptionKm ?? mileageSources.cardKm)}. The structured value is selected, but verify it.</span></aside> : null}<FactTable original={listing.normalizedFacts} effective={listing.effectiveFacts} corrections={new Set(listing.corrections.map(({ field }) => field))} />{mileageSources?.source === "facebook_structured" && !mileageSources.conflict ? <p className="muted-copy">Mileage selected from Facebook structured listing data.</p> : null}{correctionOpen ? <CorrectionForm listing={listing} client={client} onChange={onChange} onError={onError} /> : null}</section>

      <section className="original-copy"><h3>Original listing text</h3><h4>{listing.original.title}</h4>{listing.original.description === null ? <><p className="muted-copy">{listing.detailFacts === null ? "No description or Facebook vehicle metadata has been captured." : "No seller description was available, but Facebook vehicle metadata was captured."}</p>{listing.detailFacts === null ? <button className="secondary-action" type="button" disabled={busy} onClick={() => void mutate(() => client.captureDescription(listing.id))}>Capture Facebook details</button> : null}</> : <p>{listing.original.description}</p>}<ul>{listing.original.cardFacts.map((fact, index) => <li key={`${fact}-${index}`}>{fact}</li>)}</ul>{listing.sourceUrl !== null ? <a href={listing.sourceUrl} target="_blank" rel="noopener noreferrer">Open source listing</a> : <p className="muted-copy">Source URL was blocked because it was not a safe Facebook HTTPS URL.</p>}</section>

      <DealAssessment listing={listing} />

      <section className="detail-grid"><div><h3>Price history</h3>{listing.priceHistory.length === 0 ? <p className="muted-copy">No parsed price history yet.</p> : <ol className="price-history">{listing.priceHistory.map((point) => <li key={point.id}><time>{formatDate(point.observedAt)}</time><strong>{formatEur(point.priceCents)}</strong>{point.previousPriceCents !== null ? <span>{priceDelta(point.priceCents, point.previousPriceCents)}</span> : null}</li>)}</ol>}</div><div><h3>Distance & matching</h3>{listing.matches.map((match) => <div className="match-record" key={match.searchId}><strong>{match.searchName}</strong><span>{match.distance?.distance.label ?? "Distance unknown"}</span><span>{match.evaluation?.status === "needs_information" ? "Needs more information" : match.evaluation?.eligible === true ? "Hard filters passed" : "Review filter mismatches"}</span>{match.evaluation?.missingCriteria?.map((missing) => <span key={missing.criterion}>{missing.explanation}</span>)}</div>)}</div></section>

      {listing.duplicate !== null ? <section className="duplicate-record"><h3>Probable duplicate · {listing.duplicate.confidence}</h3><p>{listing.duplicate.explanation}</p><ul>{listing.duplicate.members.map((member) => <li key={member.listingId}>{member.listingUrl === null ? member.title : <a href={member.listingUrl} target="_blank" rel="noopener noreferrer">{member.title}</a>}</li>)}</ul></section> : null}

      <section className="seller-prep"><h3>Prepare the seller conversation</h3><p>This draft is never sent by Dealfinder. Copy it, review it, and send it yourself only if you choose.</p><textarea readOnly value={listing.sellerMessage} rows={4} aria-label="Seller message draft" /><button className="primary-action" type="button" onClick={() => void copyMessage()}>{copyState}</button><h4>Suggested questions</h4><ul>{listing.suggestedQuestions.map((question) => <li key={question}>{question}</li>)}</ul></section>

      <section className="notes-section"><h3>Private notes</h3><form onSubmit={addNote}><label><span>Add a note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} rows={3} /></label><button className="secondary-action" disabled={busy || note.trim() === ""}>Save note</button></form>{listing.notes.length === 0 ? <p className="muted-copy">No notes yet.</p> : <ol>{listing.notes.map((item) => <li key={item.id}><time>{formatDate(item.createdAt)}</time><p>{item.body}</p></li>)}</ol>}</section>
    </article>
  );
}

function FactTable({ original, effective, corrections }: { original: VehicleFacts | null; effective: VehicleFacts | null; corrections: Set<string> }): ReactElement {
  const fields: Array<[string, string, keyof VehicleFacts]> = [["priceCents", "Price", "priceCents"], ["year", "Year", "year"], ["mileageKm", "Mileage", "mileageKm"], ["make", "Make", "make"], ["model", "Model", "model"], ["variant", "Variant", "variant"], ["fuel", "Fuel", "fuel"], ["transmission", "Transmission", "transmission"], ["powerHp", "Power", "powerHp"]];
  return <dl className="fact-table">{fields.map(([field, label, key]) => <div key={field}><dt>{label}</dt><dd>{formatFact(key, effective?.[key])}{corrections.has(field) ? <small>Corrected · original {formatFact(key, original?.[key])}</small> : <small>Normalized</small>}</dd></div>)}</dl>;
}

function CorrectionForm({ listing, client, onChange, onError }: { listing: ListingDetail; client: ListingApiClient; onChange(detail: ListingDetail): void; onError(message: string): void }): ReactElement {
  const [field, setField] = useState("mileageKm"); const [value, setValue] = useState(""); const [reason, setReason] = useState(""); const [proposeRule, setProposeRule] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => { event.preventDefault(); const numeric = ["priceCents", "year", "mileageKm", "powerHp"].includes(field); try { onChange(await client.correct(listing.id, { field, value: value === "" ? null : numeric ? Number(value) : value, reason, proposeRule })); setValue(""); setReason(""); } catch (cause: unknown) { onError(cause instanceof Error ? cause.message : "Correction failed"); } };
  return <form className="correction-form" onSubmit={(event) => void submit(event)}><label><span>Fact</span><select value={field} onChange={(event) => setField(event.target.value)}><option value="priceCents">Price (cents)</option><option value="year">Year</option><option value="mileageKm">Mileage (km)</option><option value="make">Make</option><option value="model">Model</option><option value="variant">Variant</option><option value="fuel">Fuel</option><option value="transmission">Transmission</option><option value="powerHp">Power (hp)</option><option value="sellerType">Seller type</option></select></label><label><span>Corrected value</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Leave blank for unknown" /></label><label><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></label><label className="review-check"><input type="checkbox" checked={proposeRule} onChange={(event) => setProposeRule(event.target.checked)} /><span>Propose as reusable rule</span></label><button className="primary-action">Save correction</button>{listing.corrections.filter(({ proposal }) => proposal?.status === "pending").map(({ proposal, field: correctedField }) => proposal === null ? null : <span className="rule-decision" key={proposal.id}>Pending rule for {correctedField}<button type="button" onClick={() => void client.decideRule(proposal.id, "approve").then(() => client.get(listing.id)).then(onChange)}>Approve</button><button type="button" onClick={() => void client.decideRule(proposal.id, "reject").then(() => client.get(listing.id)).then(onChange)}>Reject</button></span>)}</form>;
}

function formatFact(key: keyof VehicleFacts, value: unknown): string { if (value === null || value === undefined || typeof value === "object") return "Unknown"; if (key === "priceCents" && typeof value === "number") return formatEur(value); if (key === "mileageKm" && typeof value === "number") return `${value.toLocaleString("en-GB")} km`; if (key === "powerHp" && typeof value === "number") return `${value} hp`; return String(value).replaceAll("_", " "); }
function formatMileage(value: number | null): string { return value === null ? "unknown" : `${value.toLocaleString("en-GB")} km`; }
function formatEur(cents: number): string { return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100); }
function formatDate(value: string): string { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
function priceDelta(current: number, previous: number): string { const difference = current - previous; return `${difference <= 0 ? "Down" : "Up"} ${formatEur(Math.abs(difference))}`; }
function labelState(state: ListingReviewState): string { return WORKFLOW.find(({ value }) => value === state)?.label ?? state; }
