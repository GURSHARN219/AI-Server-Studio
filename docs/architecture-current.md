# AI Server Studio — Current Unified Architecture

The repository is a modular monolith. One Go application owns the local HTTP
API, inference, tools, workflows, sandbox boundary, RAG persistence and
SQLite. The React application under `app/` is embedded into the Go executable,
served by the Wails asset server in desktop mode, and can run through Vite HMR
in development.

## Module map

| Responsibility | Location |
|---|---|
| React shell, pages and UI state | `app/src` |
| Shared frontend HTTP/SSE transport | `app/src/api`, `app/src/lib` |
| Mermaid rendering | `app/src/components/chat/CodeBlock.tsx`, `app/src/lib/mermaidSvg.ts` |
| Go entrypoint | `cmd/engine` |
| Embedded production UI and Wails shell | `frontend.go`, `cmd/engine/desktop.go`, `app/dist` |
| HTTP gateway and SPA fallback | `server` |
| Inference and native model loading | `engine` |
| Agent runs and persistence | `agentrun`, `persistence` |
| Workflows and recovery | `workflow` |
| Backend tool registry | `tools` |
| Isolated code execution adapter | `sandbox` |
| Document ingestion and vector ranking | `rag` |
| Portable filesystem contract | `portable` |
| Authentication and secrets | `security`, `server` |

## Runtime modes

- `aist` or `go run ./cmd/engine` starts the shared local API and opens the
  embedded UI in a Wails desktop window.
- `aist --server` runs headless API-only mode. It never starts Wails, opens a
  browser, or registers GUI routes.
- Vite HMR is a separate development command (`npm run dev`); it is not part of
  the production executable lifecycle.

The Go server keeps the API handler and authentication boundary shared by both
modes. Wails serves the embedded `app/dist` filesystem, falls back to
`index.html` for client-side routes, and mounts `/v1` requests on the same
authenticated Go handler. Missing asset paths remain 404s; `/v1` paths never
become SPA hits.

The Wails project file lives in `cmd/engine/wails.json`, not the repository
root, because Wails v2 compiles the current project directory. The build script
therefore runs from `cmd/engine`; this ensures Wails compiles the actual `main`
package rather than the root `frontend` package and automatically supplies the
`production` build tag required by Wails.

## API and persistence compatibility

Existing `/v1` routes, SSE cursor/replay behavior, agent-run wire statuses,
SQLite migrations, legacy JSON imports, owner scoping, authentication and
portable data paths remain compatibility surfaces. The root Go module is the
only authoritative Go module; the former nested backend source tree was
removed after package tests passed.

## Sandbox boundary

`sandbox.Executor` validates code size, output size, timeout, cancellation and
concurrency before starting a worker. It only runs when an explicitly
configured worker command and verified process-isolation mode are present. The
Go process does not evaluate JavaScript or Python, and missing isolation fails
closed. The normalized `run_js`/`run_python` result includes bounded stdout,
stderr, logs, result and typed error text.

## RAG boundary

`rag.Service` owns normalized document records, deterministic chunks, metadata,
embeddings, vector persistence, cosine ranking and owner-scoped deletion. Its
`Embedder` interface is provider-agnostic. A missing embedder produces an
explicit unavailable capability rather than a simulated semantic answer.
Existing `/v1/kb/documents` compatibility routes remain available while the
native `/v1/rag/status`, `/v1/rag/documents`, `/v1/rag/search` and delete routes
provide the explicit vector-RAG contract.

## Security and data rules

- Provider secrets remain backend-owned and are not returned to the renderer.
- Offline mode blocks network-bound tools; online mode is explicit.
- MCP URL validation and SSRF protections remain in the Go gateway.
- Runtime `data/`, SQLite WAL/SHM files, credentials, model weights and native
  DLLs are not source-migration deletion targets.
- The standalone Electron, sandbox and RAG service implementations are not
  supported runtime dependencies after the unified migration.

For the staged source mapping, risks and validation evidence, see
[`docs/UNIFIED_GO_MIGRATION_AUDIT.md`](UNIFIED_GO_MIGRATION_AUDIT.md).
