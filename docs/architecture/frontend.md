# Frontend architecture

The desktop application lives under `apps/desktop`. `src/api` centralizes
HTTP, authentication, and SSE transport. `src/stores` owns renderer state;
`src/hooks` contains reusable hooks; `src/components/ui` contains primitives;
and domain components remain grouped by responsibility (`chat`, `settings`,
`server`, `api-gateway`, `voice`, and `discover`).

Electron code is isolated in `electron/`. The preload exposes a narrow IPC
surface for engine and window lifecycle events. Development and packaged
launches use explicit engine paths and an explicit `AI_SERVER_DATA_DIR`.
