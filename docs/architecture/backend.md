# Backend architecture

The root Go module is the application authority. `cmd/engine` resolves
portable paths, selects the native model backend, initializes SQLite, embeds
the frontend and starts the authenticated HTTP server.

`server` owns routes, auth middleware, API serialization, SSE and SPA fallback.
`engine` owns model discovery/loading and native runtime adapters. `workflow`
and `agentrun` own durable execution state and recovery. `tools` owns tool
metadata and capability declarations. `sandbox` and `rag` are in-process Go
packages with explicit interfaces; isolated sandbox workers may remain child
processes when configured.

No Electron lifecycle, standalone Node service or mandatory Python service is
part of the supported runtime. The default process registers the embedded
frontend routes; `--server` uses the same server without registering those
browser-facing routes and remains API-only.
