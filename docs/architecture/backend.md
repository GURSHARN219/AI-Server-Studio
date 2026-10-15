# Backend architecture

`backend/goengine/cmd/engine/main.go` performs flags, runtime selection,
logging, signal handling, and server composition. Domain code remains in the
existing module packages:

- `server` registers stable HTTP routes and middleware.
- `engine` selects hardware and runs llama.cpp/vLLM integrations.
- `agentrun` owns run types, event sequencing, repositories, and legacy JSON
  import.
- `persistence` owns SQLite setup, migrations, integrity checks, and backups.
- `security` owns authentication and secret-related helpers.
- `tools` owns the backend tool registry and execution metadata.

The `/v1` API and SSE replay contract are documented in
[`docs/api-contract.md`](../api-contract.md).
