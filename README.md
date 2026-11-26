# AI Server Studio

AI Server Studio is a local-first Go application with a built-in React UI.
The Go process owns the authenticated HTTP API, inference runtime, tools,
workflows, sandbox and local persistence. The production React bundle is
embedded in the Go executable and shown in a Wails desktop window; no Electron
shell or standalone Node/Python service is required.

## Repository layout

- `app` — React/Vite frontend, tests and production bundle source.
- `cmd/engine` — Go/Wails application entrypoint; `--server` runs headless.
- `server`, `engine`, `workflow`, `agentrun`, `persistence`, `portable`,
  `security`, `tools`, `tunnel` — root Go packages and existing domain
  boundaries.
- `sandbox` — bounded, fail-closed adapter for explicitly configured isolated
  worker processes. It never evaluates untrusted code in the Go process.
- `rag` — owner-scoped document/chunk persistence and vector ranking behind
  explicit embedding and storage interfaces.
- `frontend.go` — embeds `app/dist` into the Go binary for Wails/API serving.
- `supabase` — retained migrations and optional deployment compatibility.
- `data`, `models`, `bin` — runtime state, model files and native assets; do not
  delete or overwrite them as part of source migration.

## Prerequisites

- Go 1.25+
- Node.js and npm for frontend development/builds
- Wails CLI v2.17.0 for Windows desktop builds (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0`)
- A C compiler/toolchain when building the embedded llama.cpp engine on Windows
- Windows WebView2 runtime for the desktop window

Install frontend dependencies:

```powershell
cd app
npm install
```

## Development

Run the Vite UI:

```powershell
npm run dev
```

Run the Go application with the embedded production UI:

```powershell
npm --prefix app run build
go run ./cmd/engine
```

Run Vite HMR separately during development:

```powershell
npm run dev
```

Run headless API mode:

```powershell
go run ./cmd/engine --server
```

The CLI accepts `--port`, `--model`, `--models-dir`, `--cpu`, and `--ctx`.
`--vllm` selects the vLLM backend and requires `--server`. With no arguments,
the Go process starts one local API backend and opens the embedded React bundle
in a Wails desktop window. The `--server` mode is strict API-only: it never
starts Wails, opens a browser, or registers frontend routes.

Root scripts provide the same orchestration:

```powershell
npm run dev
npm run dev:engine
npm run typecheck
npm run test
npm run lint
npm run build
```

## Validation

```powershell
npm run typecheck
npm run test
npm run lint
npm run build
go test ./...
go vet ./...
New-Item -ItemType Directory -Force build\bin | Out-Null
go build -tags desktop,production -o build/bin/AI-Server-Studio.exe ./cmd/engine
```

Build the production Windows desktop executable with the Wails v2 process:

```powershell
npm run build:desktop:windows
```

The script builds `app/dist`, runs Wails from `cmd/engine` so the `main` package
is compiled, passes the production/WebView2 build configuration, verifies the
embedded bundle, copies loader-visible native dependencies, and writes the
final portable package to `build/bin`.

Do not replace this with a plain `go build ./cmd/engine` on Windows. Wails v2
requires the `desktop,production` build tags for the real desktop implementation;
without them Wails intentionally compiles its Windows diagnostic stub, which
shows “Wails applications will not build without the correct build tags”.

Lint currently reports existing warnings but no errors. The production bundle
contains large Mermaid/graph chunks; this is a performance follow-up, not a
runtime failure.

Launch the packaged application with:

```powershell
.\build\bin\AI-Server-Studio.exe
```

## Runtime data and portable mode

Packaged launches are portable by default. The portable root is the directory
containing the executable (`build/bin` for the standard package), and
application-owned state is kept below:

```text
<portable root>/
  portable.json
  .runtime/engines/
  .runtime/libraries/
  .runtime/manifests/
  agents/
  backups/
  cache/
  config/
  db/studio.sqlite
  downloads/
  logs/
  memory/
  models/
  skills/
  mcp/
  toolcalls/
  temp/
  workflows/
```

`AIST_PORTABLE_ROOT` is an explicit override. `AI_SERVER_DATA_DIR` is accepted
only within that root. Existing `.portable/data`, `data/`, and `runtime/`
installations are detected and reused without deletion or silent migration.
There is no silent fallback to a profile, temp or home directory. SQLite
migrations, legacy agent-run import and native model paths remain compatibility
surfaces.

See [`docs/portable-mode.md`](docs/portable-mode.md) and the migration audit
[`docs/UNIFIED_GO_MIGRATION_AUDIT.md`](docs/UNIFIED_GO_MIGRATION_AUDIT.md).

## Sandbox and RAG capability boundaries

Sandbox execution requires an operator-configured isolated worker command and
`AIST_SANDBOX_ISOLATION=process`. Without that verified boundary, `run_js` and
`run_python` return an explicit unavailable error. Python and JavaScript are not
implicitly discovered or executed by the Go process.

RAG ingestion/search requires an injected embedding provider. If no provider is
configured, the API reports `capability_unavailable`; it does not return fake
semantic results. Existing owner-scoped document CRUD and Supabase migrations
remain intact.

Mermaid definitions render directly in the React UI using the maintained
`mermaid` package with loading, error and SVG validation states.

## Application updates

The Go backend exposes `GET /v1/system/update` and the `updater` package for
trusted-manifest checking and SHA-256-verified staging. Configure an approved
HTTPS manifest source with `AIST_UPDATE_MANIFEST_URL`; without it the endpoint
returns `unavailable` and does not pretend that live updates are operational.
Staging never replaces a running executable and never touches `data/` or model
files. Release promotion and signed-artifact verification require a configured
deployment-specific verifier and are intentionally not enabled by default.
