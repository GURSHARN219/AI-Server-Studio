# AI Server Studio — Current Architecture and Migration Boundaries

This document records the implemented architecture boundary after the durable
agent-run and SSE reliability refactoring. It describes the current source
tree, not an aspirational microservice deployment.

## Current module map

| Responsibility | Current location | Boundary |
|---|---|---|
| React shell and pages | `apps/desktop/src/App.tsx`, `apps/desktop/src/pages` | Presentation and navigation |
| Chat and UI state | `apps/desktop/src/components/chat`, `apps/desktop/src/stores` | Renderer-only state |
| Shared HTTP transport | `apps/desktop/src/api/client.ts` | JSON requests, auth header, normalized errors |
| Agent HTTP client | `apps/desktop/src/api/agents.ts` | Run commands and event URLs |
| Legacy API compatibility | `apps/desktop/src/lib/api.ts` | Existing provider, tool, auth, and MCP callers |
| Agent progress UI adapter | `apps/desktop/src/hooks/useAgentRunner.ts` | SSE cursor/reconnect and UI event mapping |
| Electron lifecycle | `apps/desktop/electron/main.ts`, `preload.ts` | Process supervision and explicit IPC |
| HTTP gateway | `backend/goengine/server` | Routing, middleware, DTO decoding, serialization |
| Inference | `backend/goengine/engine` | Existing `EngineInterface`, llama.cpp, and vLLM |
| Run domain and persistence | `backend/goengine/agentrun` | Versioned JSON repository and durable run types |
| Run coordination | `backend/goengine/server/agent_run_store.go` | Serialized commits, event sequencing, checkpoints |
| Tool metadata | `backend/goengine/tools` | Backend-owned definitions and capability metadata |

The project remains a modular monolith. The engine and Electron-supervised
processes remain separate where process isolation is useful; no new network
microservice is required by this refactoring.

## Durable agent-run contract

Runs are stored below `agent-runs` in the resolved `AI_SERVER_DATA_DIR`.
Each run is a versioned JSON document. Writes use a temporary file in the same
directory, `Sync`, close, and rename. A process-local lock serializes reads and
writes for the repository.

The current wire-compatible statuses are `running`, `done`, `error`, and
`canceled`. The domain also defines `queued`, `awaiting_approval`, and
descriptive aliases `completed`, `failed`, and `cancelled` for the next
compatibility-preserving migration.

Each run contains:

- identity, goal, model, owner/session association, and execution metadata;
- terminal status, result/error, timestamps, and cancellation intent;
- an ordered event log with a per-run `sequence` starting at 1;
- the most recent execution checkpoint.

Events are persisted before subscribers are notified. An interrupted
non-terminal run is retained and marked as failed on the next server start;
the system does not blindly repeat an in-flight tool call.

## SSE replay contract

`GET /v1/agent/runs/{id}/events` accepts either:

- `Last-Event-ID: <sequence>`; or
- `?cursor=<sequence>` for clients such as browser `EventSource` that cannot
  set arbitrary headers.

The response emits both an SSE `id` and a JSON `sequence`:

```text
id: 14
data: {"sequence":14,"type":"tool.completed","timestamp":...,"data":{...}}
```

The frontend remembers the highest accepted sequence, ignores duplicate or
older events, and reconnects with a bounded exponential backoff. Legacy events
without sequence numbers remain renderable but cannot provide replay
deduplication guarantees.

## Backend-owned tool registry

`backend/goengine/tools` owns tool names, descriptions, input schemas,
capabilities, approval metadata, and enabled state. The gateway exposes:

```text
GET  /v1/tools
POST /v1/tools/execute
```

The execution endpoint validates the requested tool against the registry and
accepts legacy aliases for the existing web-search and URL-fetch tools. The
existing SSRF and HTTPS checks remain in the execution adapter. Future MCP and
HTTP adapters should register definitions here rather than trusting a tool
name supplied by the renderer.

## Migration rules

1. Keep existing `/v1` routes and response fields stable while adapters move
   behavior into application packages.
2. Add new frontend API modules without removing `lib/api.ts` until all callers
   have migrated.
3. Keep localStorage chat persistence during conversation-repository work;
   import it explicitly before introducing server-side deletion or migration.
4. Do not resume a checkpoint containing an unfinished side effect without an
   explicit idempotency/approval decision.
5. Add repository and route tests before changing the storage implementation.

## Remaining migration work

Phase 2 storage migration is complete: `task_runs` is the canonical status row;
the existing agent-run routes, wire statuses, event log, checkpoints, JSON
import backups, and SSE cursors remain compatibility surfaces. The old
`agent_runs` table is retained as an internal status/state projection until a
later cleanup decision.

- Move the agent execution loop from route files behind an `AgentRuntime`
  interface.
- Add durable conversation/message repositories and localStorage import.
- Move provider routing and cloud calls fully behind the backend; never expose
  provider secrets through renderer storage or logs.
- Add approval records and policy decisions for high-impact tools.
- Add cross-process locking or SQLite if multiple backend processes may share
  the same data directory.
