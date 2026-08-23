# Dealfinder

Dealfinder is a local-first workspace for collecting and reviewing deals.
Version one is intended to run natively and manually on the host machine; Docker
is not part of the supported development workflow.

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
