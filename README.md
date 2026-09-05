# Dealfinder

Dealfinder is a local-first workspace for collecting and reviewing deals.
Version one is intended to run natively and manually on the host machine; Docker
is not part of the supported development workflow.

## Watching multiple models

Use **Add models** in Saved searches to enter one make/model pair per target,
with an optional required variant. Add up to 20 targets at once; shared filters
are copied into each search, with optional maximum price, minimum year and mileage
overrides. Blank overrides inherit the shared filter at creation time. Each target
then has its own editable filters, priority, verification and scan schedule.
Verify each target in Facebook before scanning. The existing ten-active-search
confirmation applies to the whole batch, which saves all targets or none.

Results share one inbox. Use **Model / saved search** to review one target and its
assessment, or leave **All models and searches** selected. Valuation cohorts remain
separate by vehicle make/model. Model targets compare model identities rather than
substrings; case, accents, punctuation and common make aliases such as VW are
normalized. Custom model names are supported, but there is no exhaustive model or
trim alias catalog. Existing keyword searches remain available through **New search**.

## Scan limits and deep scans

Each saved search has editable **Scan limits**. Existing searches start with:

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| First-scan card limit | 300 | 1–10,000 |
| Consecutive known listings | 50 | 1–1,000 |
| Maximum cards per scan | 1,000 | 1–10,000 |
| Collection time budget | 120 seconds | 15–1,800 seconds |

The first-scan cap and known threshold cannot exceed the maximum card budget.
A standard first scan uses the initial cap. Later standard scans stop at the known
threshold, counting only distinct listings previously observed **in that search**.
A listing known only through another search resets the counter, while global
listing IDs still prevent duplicate records. Repeated cards in one scan do not
advance the counter.

**Deep scan** bypasses the first-scan cap and known threshold, but retains maximum
cards and collection time. It starts from the top; it does not resume pagination or
guarantee complete inventory coverage. Requests are durable: deep requests upgrade
queued standard scans and remain deep after restart. Scheduled scans stay standard.
Limits are read when a scan begins; edits do not require Facebook reverification.

Time is checked between browser operations using a monotonic clock. An operation
already in flight finishes before the shared browser moves to another search;
ingestion and subsequent detail/enrichment processing are outside the collection
budget. Partial results are retained on budget exhaustion, and incomplete scans do
not count as full snapshots for detecting disappeared listings. Each completed run
stores its stop reason (`initial_limit`, `known_streak`, `card_limit`, `time_limit`,
`results_end`, or `no_progress`).

## Requirements

- Node.js 22.5 or newer (for the built-in `node:sqlite` module)
- npm 10 or newer

## Install and verify

From the repository root:

```sh
npm ci
npm run browser:install
npm run typecheck
npm test
npm run build
```

## Run locally

Start the API, background runtime, and development dashboard together:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. The dashboard proxies API requests to the server
at `http://127.0.0.1:3000`. Both listeners use loopback addresses only. Stop the
command with Ctrl+C; the server closes HTTP work before closing SQLite.

To exercise the production path, build once and start the server:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:3000`. In this mode the server serves the built React
dashboard itself. `GET /api/health` reports server and database readiness.

The workspace is intentionally split into four independently buildable areas:

- `apps/server` — server and background runtime
- `apps/web` — React dashboard
- `packages/domain` — shared domain types and behavior
- `packages/db` — local persistence implementation

The server configuration is loaded from `.env.local` when that ignored file is
present. Its defaults use `127.0.0.1`, the `Europe/Lisbon` timezone, and a data
directory at `~/.local/share/dealfinder`. SQLite, Chromium state, diagnostics,
and backups are derived beneath that directory. Set
`DEALFINDER_DATA_DIR` to move the complete local runtime area.

`npm run browser:install` installs the Chromium build used for the visible,
manually authenticated Facebook session. The dashboard opens and stops that
browser explicitly; it never launches headless, imports an account, or stores a
Facebook password. Browser session data remains in the dedicated profile under
the configured data directory so a manual login can be reused after restart.

To verify a saved search, open the controlled browser and choose **Verify
Facebook** on that search. DealFinder opens a generated Marketplace vehicle
search and lists criteria that will be checked locally. Confirm only while the
visible tab shows the intended results; the current Marketplace URL and
verification time are then saved automatically. Editing criteria or location
marks that verification stale, while renaming, pausing, or reprioritizing does
not. The dashboard never accepts a pasted listing or search URL.

Marketplace parser fixtures use a small, versioned and privacy-reviewed card
contract. To intentionally refresh one after capturing a result page, write to
a new file rather than editing the capture in place:

```sh
npm run fixtures:sanitize -- /path/to/captured.html apps/server/test/fixtures/facebook/results-new.html
```

Review the inferred title, price, location, and facts; remove any seller or
account information; then replace `reviewed: pending` in the provenance comment
with the review date. `npm run fixtures:check` rejects pending reviews, scripts,
forms, session/contact markers, profile links, and unapproved external URLs.
Raw captures must remain outside the repository and be deleted after review.

Verified active searches share one sequential scan queue. Each manual startup
queues one priority-ordered catch-up; work waits safely if the visible browser
is not open and resumes when it opens. Successful searches are scheduled at a
randomized 15–30 minute interval, while failures use bounded backoff. Initial
scans retain at most 300 cards; later scans stop after 50 consecutive known
listing IDs. Dashboard **Scan** requests enter this same durable queue, and the
saved-search list reports persisted last/next scan times.

Hard-filter evaluation distinguishes **Matches**, **Excluded**, and **Needs more
information**. Missing facts do not count as confirmed mismatches: plausible
incomplete vehicles enter DeepSeek enrichment and remain visible in the inbox,
but receive no score until all hard criteria are confirmed. Known hard failures
stay excluded. The worker rechecks current facts before sending a provider
request, and scoring rechecks eligibility using enriched facts afterward.
Existing unprocessed incomplete listings are queued automatically by migration.

Result cards persist a description when Facebook exposes one. After each
successful search scan, a bounded batch captures details for up to five active,
non-excluded vehicles, prioritizing those missing required facts. Remaining
candidates wait for later scans. Attempts and cooldowns persist across restarts:
successful captures are refreshed after seven days, failures retry after one
day, and browser unavailability stops the batch. Captures use the visible
controlled browser and retain allowlisted vehicle facts locally. They refresh
normalization and match eligibility, then queue enrichment for any vehicle
still plausible for at least one linked search. Missing information remains
unknown if capture or enrichment cannot resolve it.

The listing inspector also offers **Capture full description** for manual
capture of a selected listing.

During a detail capture, the parser also reads a small allowlisted
set of Facebook vehicle metadata. Structured mileage is selected when present;
seller-description (or result-card) mileage is the fallback. Both values are
retained, and a mileage conflict is surfaced in the listing detail for
verification. Structured make,
model, fuel, transmission, condition, and related vehicle fields are retained
as metadata; the normalized vehicle fields use the structured values when
available.

Listing distance uses a bundled offline set of Portuguese locality centroids.
Lookups make no network requests and therefore have no external rate limit;
resolved and unknown localities are cached in SQLite. Values are labelled as
approximate straight-line distance from the search origin, never as routes,
driving distance, or travel time. Nationwide searches do not calculate a
distance, and an unknown locality never excludes a listing.

Facebook checkpoints, login and consent prompts, Marketplace restrictions,
rate limits, empty or partial results, and unreviewed selector layouts fail
closed. DealFinder commits no observations from that scan, records the affected
browser/source/search pause, and waits for an explicit dashboard resume. A
failure screenshot and text-free structural DOM artifact remain only in the
local diagnostics directory and expire after seven days; screenshots are never
sent to integrations, and selector repair is never attempted automatically.

The Telegram and DeepSeek credentials are optional and may remain unset until
their integrations are configured. Configuration validation rejects malformed
values with field-specific messages, and configuration views and structured
logs redact tokens and API keys.

DeepSeek enrichment uses only `deepseek-v4-flash` with thinking disabled and a
strict JSON schema. Provider requests contain the listing title, description,
and normalized vehicle facts only. An insufficient-credit response leaves raw
Facebook scans running but durably pauses AI enrichment and alerts;
new candidates remain queued. After adding credit, explicitly test it with
`POST /api/integrations/deepseek/credit`. AI processing resumes only when the
provider balance check succeeds and reports credit available. Deterministic
assessments of already enriched listings remain available during a credit pause. `GET` on the same
endpoint reports the persisted pause state.

Deal assessments separate three independent dimensions; there is no combined
score out of 100:

- **Market value** compares the full asking price with comparable vehicles. With
  at least five comparables, it reports the median, the middle 50% asking-price
  range, and percentage above or below the median. This describes asking prices,
  not a predicted sale price. With insufficient evidence, range and discount are
  null. Suspicious or ambiguous prices show **Verify asking price** and never
  claim a bargain discount.
- **Personal fit** reports the percentage of known soft preferences matched,
  alongside matched, missed, and unknown counts and per-preference explanations.
  No configured preferences means no fit percentage. Partial results are labelled
  as a percentage of known preferences. Distance is shown separately; neither
  distance nor personal preferences changes market value or valuation confidence.
- **Valuation confidence** is an explainable low/medium/high evidence rating,
  not a probability. It considers comparable count, known facts, price spread,
  observation recency, unknown variants, enrichment uncertainties, and captured
  fact conflicts. Recent narrow cohorts with at least ten comparables can earn
  high confidence; missing or conflicting evidence limits it.

Comparable cohorts require the same make/model, compatible variant, a two-year
band, a 40,000 km mileage band, fuel, and transmission. Recorded duplicate groups
count once, including exclusion of the subject's own relistings. Sold/inactive
vehicles and observations older than 90 days are excluded from reference history.
Unknown variants may provide comparisons but prevent high confidence. Outliers
are removed before calculating the median and range.

The inbox defaults to recently seen listings and offers separate market-discount,
personal-fit, and confidence sorting. The inspector identifies the saved search
and lets you switch between its assessments when a listing belongs to several
searches. `GET /api/listings?sort=recent|market_value|personal_fit|confidence` selects
an inbox order. `GET /api/searches/:searchId/deal-scores` returns version 2
assessments in market-discount order, then personal fit and listing ID as tie
breakers. Each `score` contains `marketValue`, `personalFit`, and `confidence`;
legacy `total` and additive component fields are removed. Migration 21 clears
only derived version 1 assessments and cohorts; startup rebuilds assessments
from retained listing facts and enrichment, without new provider requests.

SQLite data is migrated automatically when `openDatabase` opens a connection.
The database uses foreign-key enforcement, WAL journaling for file-backed
connections, atomic migration records, and UTC ISO-8601 text timestamps. The
settings repository is only for non-sensitive preferences: credentials,
Facebook sessions, and browser cookies must never be added to its schema.

### Adding a migration

Add a numbered migration under `packages/db/src/migrations/`, give it the next
consecutive integer version, and append it to `allMigrations` in that folder's
`index.ts`. Migrations run once in version order inside transactions. Never edit
an applied migration; add the next migration instead. Tables should use
snake_case names, explicit foreign keys and uniqueness constraints, and UTC
ISO-8601 text timestamp columns. Add repository integration tests with the
feature that owns each new table.

The application shell is intentionally minimal until collection features are
added. Runtime services use a shared ordered lifecycle so later background
workers can start and stop cleanly with the HTTP server and database.

## Local files

Copy `.env.example` to `.env.local` when local configuration is needed. Keep
credentials out of tracked files. Runtime data, browser profiles, screenshots,
backups, and build output are ignored by Git.
