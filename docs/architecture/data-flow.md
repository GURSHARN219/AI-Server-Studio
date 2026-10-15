# Data flow

The renderer sends authenticated requests to the local Go engine. Vite proxies
`/v1`, `/health`, and `/ws` during development; packaged Electron loads the
built renderer and receives the dynamically selected engine port over IPC.

Chat state and settings are persisted through authenticated Go endpoints.
Agent runs are committed to SQLite before live SSE subscribers are notified,
so reconnecting clients can replay events by sequence. Legacy browser chat
storage is imported only through an explicit owner-scoped migration.
