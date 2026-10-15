# Architecture overview

AI Server Studio is a modular monolith with two local processes:

1. Electron supervises the desktop renderer and the Go engine.
2. The Go engine owns the authenticated HTTP API, model runtime, tools, and
   SQLite persistence.

The application remains local-first. The existing Supabase functions and
migrations are retained as legacy/migration surfaces and are not part of the
desktop startup path.

The current source boundaries are intentional. The Go module already separates
server, inference, agent-run, persistence, security, and tools packages; it
does not expose those packages as a reusable public SDK. Moving every package
under `internal/` would change import paths without improving behavior, so
only the executable entrypoint was moved to `cmd/engine`.
