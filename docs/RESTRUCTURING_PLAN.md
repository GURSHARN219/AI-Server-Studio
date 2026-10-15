# Repository restructuring plan

This document records the approved incremental restructuring boundary for AI
Server Studio. It is intentionally separate from runtime data and does not
authorize moving or deleting user data, credentials, SQLite files, generated
builds, or legacy integrations.

## Baseline

- Baseline commit: `8a7e9e8` (`chore: establish project baseline`)
- Repository root: `A:\Tempestoxprojects\AI_Server_Studio`
- Persistent runtime authority: SQLite under `AI_SERVER_DATA_DIR`
- Legacy agent-run source: runtime `agent-runs` directory, retained for import
- Compatibility requirement: preserve `/v1` routes, agent-run wire formats,
  `task_runs`/`agent_runs` migration behavior, and Supabase deployment files

The baseline intentionally excludes local `.env` files, runtime data,
authentication sessions, provider snapshots, SQLite files, logs, generated
bundles, native runtime binaries, `node_modules`, local Supabase metadata, and
other machine-specific artifacts through `.gitignore`.

## Stage sequence

### Stage 0 — repository safety checkpoint — complete

- Initialized Git because this directory is the confirmed project root and had
  no existing repository history.
- Added ignore rules for secrets, runtime data, databases, logs, generated
  outputs, dependencies, native binaries, and local metadata.
- Reviewed staged paths and scanned staged content for common credential
  patterns without printing secret values.
- Created the clean baseline commit above.

### Stage 1 — documentation and inventory — in progress

- Keep current package paths unchanged.
- Document package boundaries, runtime paths, generated artifacts, Supabase
  classification, and migration constraints.
- Do not alter SQLite migrations or runtime path resolution.

### Stage 2 — frontend organization — pending

- Prefer feature-local moves only where they reduce coupling.
- Keep `components/ui`, `api`, `stores`, `hooks`, `lib`, `integrations`, and
  `types` stable unless a caller-checked move is justified.
- Preserve Vite aliases, Electron IPC types, routes, streaming, and SSE tests.

### Stage 3 — Go package boundaries — pending

- Move one cohesive package at a time into `backend/goengine/internal/` only
  after all importers and tests are identified.
- Preserve the Go module path, SQLite migration names/checksums, and API routes.
- Do not create empty placeholder packages for future phases.

### Stage 4 — extension and packaging paths — pending

- Resolve the difference between current `apps/desktop/extensions` sources,
  Electron `extraResources`, Go `extensions/backends` lookup, and optional
  Aistclaw paths before moving anything.
- Verify development and packaged startup separately.

### Stage 5 — final documentation and developer commands — pending

- Update documentation only after actual paths and commands pass validation.
- Keep npm/Bun lockfile policy unchanged unless separately approved.

## Runtime-data safety rules

The following are not source-tree move targets:

- `data/`
- `backend/goengine/data/`
- `AI_SERVER_DATA_DIR` contents
- SQLite databases and WAL/SHM files
- legacy JSON agent runs
- provider/API credentials and session tokens
- model weights and native runtime binaries

Any future runtime-path change requires a separate backup, verification, and
idempotent migration plan. Existing copies must remain until verification is
complete.

## Known risks and rollback

| Change | Primary risk | Rollback |
|---|---|---|
| Frontend source move | stale aliases/imports | restore the affected move from the preceding commit and rerun frontend tests |
| Go package move | import cycles or platform build failures | revert the package move commit; runtime data is untouched |
| Electron/resource move | packaged engine or DLL discovery failure | restore prior resource paths and rebuild Electron |
| Runtime-data path change | data loss or duplicate stores | do not proceed without a backup and verification report |

Rollback is source-only. No rollback step may delete or overwrite runtime data,
credentials, SQLite databases, legacy JSON files, or generated model assets.
