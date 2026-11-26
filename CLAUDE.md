# AI Server Studio — Contributor Instructions

These instructions describe the current repository, its supported runtime, and
the quality bar for changes. Keep this file aligned with the code and the
canonical documents linked below.

## Project shape

AI Server Studio is a local-first modular monolith:

- **Go** owns the authenticated HTTP API, inference runtime, tools, workflows,
  sandbox boundary, RAG persistence, SQLite, portable paths, and secrets.
- **React/Vite** lives under `app/` and communicates with Go through the
  same-origin HTTP/SSE API.
- **Wails** provides the Windows desktop shell for the embedded production UI.
- **Headless mode** runs the same Go server without Wails or browser routes.
- `app/dist` is embedded into the Go executable for production serving.

Use these documents as the detailed source of truth:

- `README.md` — setup, commands, packaging, runtime data, and capability gates.
- `docs/architecture-current.md` — module map and runtime contracts.
- `docs/architecture/backend.md` and `docs/architecture/frontend.md` — layer
  boundaries.
- `docs/architecture/security.md` — security invariants.
- `docs/portable-mode.md` and `docs/storage-inventory.md` — filesystem and data
  compatibility rules.
- `docs/UNIFIED_GO_MIGRATION_AUDIT.md` — migration history, evidence, and
  remaining release blockers.

## Important repository state

The worktree may contain a large, intentional Go/frontend consolidation with
uncommitted moves and deletions. Before editing:

1. Run `git status --short`.
2. Treat existing changes as user work.
3. Do not use `git reset`, `git clean`, broad deletes, history rewrites, or
   destructive cleanup to resolve conflicts.
4. Do not overwrite runtime data, SQLite files, WAL/SHM files, credentials,
   model weights, or native DLLs while changing source.

Keep changes focused and make unrelated work visible rather than absorbing it
into the task.

## Before coding

Turn the request into a small, testable outcome. State assumptions when they
matter; ask only when an unresolved choice changes the result. Prefer the
simplest existing path over a new abstraction, dependency, service, or config
surface.

For a non-trivial change:

1. Read the relevant implementation, callers, tests, and architecture notes.
2. Identify the boundary that must remain compatible.
3. Define the acceptance check before editing.
4. Make the smallest complete change.
5. Run the narrowest relevant check, then the broader project checks when
   practical.

Every changed line should trace to the requested behavior, its test, or a
necessary compatibility fix. Do not refactor neighboring code just because it
could be written differently.

## Architecture and security invariants

Preserve these behaviors unless the task explicitly changes them:

- `server` owns routes, authentication, API serialization, SSE, and SPA
  fallback. Do not bypass it with renderer-only implementations.
- `cmd/engine` is the application entrypoint. The default mode starts the
  desktop UI plus local API; `--server` is API-only and must not start Wails or
  browser-facing routes. `--vllm` requires `--server`.
- `engine` owns model discovery/loading and native runtime adapters. Keep
  platform-specific code behind the existing platform files and interfaces.
- `workflow` and `agentrun` own durable execution and recovery; preserve
  cancellation, replay, and status compatibility.
- `tools` owns tool metadata and capability declarations. Route tool execution
  through the authenticated Go boundary.
- Sandbox execution is fail-closed. Never treat a goroutine, Node VM, restricted
  Python built-ins, or an unrestricted child process as OS isolation. Without a
  verified configured isolated worker, return the existing unavailable error.
- RAG must not fabricate semantic results. Without a configured real embedder,
  report capability unavailability; preserve owner scoping and model/dimension
  metadata.
- Provider/API secrets remain backend-owned. Renderer responses may expose
  metadata such as `has_key`, never usable credentials.
- Offline/online policy, HTTPS/loopback/SSRF checks, portable-root containment,
  and owner isolation are security contracts, not optional cleanup.
- Preserve existing `/v1` routes, SQLite migrations, legacy imports, SSE
  behavior, and portable path compatibility unless a migration is explicitly
  part of the task.

## Implementation standards

### Go

- Run `gofmt` on changed Go files.
- Prefer clear package boundaries, descriptive names, small functions, and
  explicit error paths.
- Propagate `context.Context` for cancellation and shutdown-sensitive work.
- Use existing typed errors and capability/status conventions instead of adding
  ad-hoc response shapes.
- Keep filesystem, model, credential, and native-runtime changes inside the
  existing portable and security boundaries.

### React and TypeScript

- Follow the existing structure under `app/src`: pages, components, hooks,
  stores, API clients, and tests.
- Use the shared API/SSE clients; do not reintroduce Electron or standalone
  service assumptions.
- Preserve strict types and existing state ownership. Avoid `any`, direct
  mutation, speculative hooks, and duplicated transport logic.
- Keep UI behavior accessible and maintain existing loading, error, empty, and
  unavailable states.

### Simplicity and review quality

- KISS/YAGNI: no speculative flexibility, one-use abstraction, or new
  dependency without a concrete need.
- Explain non-obvious **why** in comments; do not narrate obvious code.
- Remove only imports, variables, or helpers made unused by the change.
- Review invalid, empty, repeated, cancellation, unavailable, and permission
  paths—not only the happy path.
- Do not weaken or delete tests to make a check pass.

## Development commands

Run commands from the repository root unless noted otherwise.

```powershell
# Install frontend dependencies
npm install --prefix app

# Frontend HMR
npm run dev

# Build the production UI and run the embedded desktop/API process
npm run build
go run ./cmd/engine

# Headless API-only mode
go run ./cmd/engine --server
```

Supported engine flags are `--server`, `--vllm`, `--cpu`, `--port`, `--ctx`,
`--model`, and `--models-dir`. `--vllm` requires `--server`.

For a Windows desktop package, use the repository script rather than a plain
`go build`:

```powershell
npm run build:desktop:windows
```

That path requires Go, npm, Wails v2.17.0, a C/C++ toolchain, WebView2, and the
native DLLs described in `README.md`.

## Verification commands

Run the narrowest relevant check first. The standard project checks are:

```powershell
npm run typecheck
npm run test
npm run lint
npm run build
go test ./...
go vet ./...
go build ./cmd/engine
```

The frontend lint command currently has known warnings but should have no
errors. CGO/GPU inference, real semantic embeddings, OS-isolated sandbox
execution, and clean-machine Windows packaging require environment-specific
assets or services; record them as skipped or blocked rather than claiming
success.

When behavior changes, add or update a focused regression test in the existing
test location. Prefer tests that exercise the public boundary: HTTP/API
responses, persisted state, frontend user behavior, capability errors,
timeouts, cancellation, owner scoping, or CLI mode selection.

## Completion checklist

Before reporting completion:

- The requested behavior is implemented, not merely planned.
- Existing callers, exports, routes, data formats, and tests were checked.
- The diff is focused and does not erase unrelated work.
- Relevant checks were actually run and their results are reported accurately.
- Remaining environment or release gaps are explicit.
