# Dealfinder

Dealfinder is a local-first workspace for collecting and reviewing deals.
Version one is intended to run natively and manually on the host machine; Docker
is not part of the supported development workflow.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Install and verify

From the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

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

The Telegram and DeepSeek credentials are optional and may remain unset until
their integrations are configured. Configuration validation rejects malformed
values with field-specific messages, and configuration views and structured
logs redact tokens and API keys.

The localhost application shell and persistence layer are added by later
phase-one commits.

## Local files

Copy `.env.example` to `.env.local` when local configuration is needed. Keep
credentials out of tracked files. Runtime data, browser profiles, screenshots,
backups, and build output are ignored by Git.
