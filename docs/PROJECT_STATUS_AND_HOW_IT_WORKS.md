# AI Server Studio — Status and operation

## Current state

The repository has been consolidated into a root Go module with the React UI
under `app/`. The Go process serves the production bundle from an embedded
filesystem, opens the production UI in a Wails desktop window, and supports
headless API mode.

Implemented migration surfaces:

- root Go packages and root `go.mod`/`go.sum`;
- frontend same-origin transport with no Electron bridge;
- Go-owned sandbox registry and fail-closed isolated-worker adapter;
- Go-owned RAG schema, chunking, embedding interface, vector persistence and
  cosine ranking;
- native Mermaid rendering in React with SVG validation;
- portable path, SQLite, agent-run, workflow and native model compatibility.

## Start locally

```powershell
npm install --prefix app
npm --prefix app run build
go run ./cmd/engine
```

For Vite HMR development, run Vite separately:

```powershell
npm --prefix app run dev
```

For API-only mode:

```powershell
go run ./cmd/engine --server
```

## Verification

```powershell
npm --prefix app run typecheck
npm --prefix app run test
npm --prefix app run lint
npm --prefix app run build
go test ./...
go vet ./...
```

Lint has existing warnings but no errors. Native CGO/GPU checks remain
environment-dependent and require the supported compiler, driver and model
assets.

## Capability gaps

Sandbox tools return an explicit unavailable error until an operator supplies a
verified OS-isolated worker command. RAG semantic ingestion/search returns an
explicit unavailable error until an embedding provider is injected. These are
intentional fail-closed behaviors, not simulated successes.

Supabase migrations remain retained for optional deployment compatibility. User
data, SQLite files, model weights, native assets and credentials are not removed
by the source migration.
