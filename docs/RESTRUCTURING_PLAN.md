# Unified Go application migration record

The migration described by this record is complete for source consolidation.
The repository now has one root `go.mod`, a React/Vite application under
`app/`, embedded production UI support, and root Go packages for the existing
engine, server, persistence, workflow and security boundaries.

## Completed stages

1. **Audit** — Electron APIs, frontend paths, sandbox services, RAG services,
   Mermaid usage, portable data, SQLite migrations and native runtime assets
   were mapped in [`UNIFIED_GO_MIGRATION_AUDIT.md`](UNIFIED_GO_MIGRATION_AUDIT.md).
2. **Frontend** — source/config/static assets moved to `app/`; browser API
   transport is same-origin; Vite HMR remains available.
3. **Go consolidation** — packages and module moved to repository root;
   `frontend.go` embeds `app/dist` when the production bundle is built.
4. **Sandbox/RAG** — native Go packages, registries, routes, owner scoping,
   bounded execution and focused tests are in place. Missing isolation or
   embedding providers fail closed.
5. **Service cleanup** — Electron, standalone sandbox/RAG/Mermaid services and
   their manifests/dependencies were removed. Mermaid remains a frontend
   package feature.
6. **Documentation/scripts** — root orchestration, portable packaging,
   architecture and setup docs now describe the Go/browser runtime.

## Safety boundaries

- Runtime data, credentials, SQLite files, model weights and native assets were
  preserved; legacy Go runtime data was copied under `data/legacy-goengine`.
- No destructive git reset or history rewrite was used.
- Supabase migrations/functions remain because they are optional compatibility
  and deployment surfaces.
- Existing `/v1` routes, SSE behavior, agent-run import and SQLite migration
  contracts remain compatibility surfaces.

## Required checks

```powershell
npm run typecheck
npm run test
npm run lint
npm run build
go test ./...
go vet ./...
go build ./cmd/engine
```

CGO/GPU builds, OS-isolated sandbox worker execution and real embedding/vector
provider tests require environment-specific assets or services and must be run
in the target deployment environment before release.
