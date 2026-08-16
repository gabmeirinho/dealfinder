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

At this scaffold stage, these packages contain only their compileable entry
points and placeholder tests. Later commits add configuration, persistence, and
the localhost application shell.

## Local files

Copy `.env.example` to `.env.local` when local configuration is needed. Keep
credentials out of tracked files. Runtime data, browser profiles, screenshots,
backups, and build output are ignored by Git.

