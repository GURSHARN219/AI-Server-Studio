# AI Server Studio

AI Server Studio is a local-first desktop application for running and
managing AI models. The desktop renderer is a Vite/React application hosted by
Electron, and the local Go engine provides the authenticated HTTP API,
inference runtime, tools, and SQLite persistence.

## Repository layout

- `apps/desktop` - React renderer, Electron main/preload process, MCP
  extensions, and desktop packaging configuration.
- `backend/goengine` - Go module. `cmd/engine` contains startup wiring;
  `server`, `engine`, `agentrun`, `persistence`, `security`, and `tools`
  contain the existing domain boundaries.
- `data` and `backend/goengine/data` - legacy repository data snapshots. They
  are not authoritative runtime locations and must not be merged or deleted
  without an explicit migration.
- `docs` - current architecture and API documentation.
- `scripts` - maintenance and local infrastructure helpers.
- `supabase` - retained legacy/migration integration; the renderer no longer
  depends on it at runtime.

## Prerequisites

- Node.js and npm
- Go 1.24+
- A C compiler/toolchain when building the embedded llama.cpp engine on
  Windows

Install frontend dependencies from the application directory:

```powershell
cd apps\desktop
npm install
```

## Development

Run the renderer:

```powershell
npm run dev
```

Run the Go engine:

```powershell
npm run dev:engine
```

Run Electron (builds the development engine first):

```powershell
npm run dev:electron
```

All commands above can be run from the repository root. The equivalent
frontend commands are available from `apps\desktop`.

## Tests and builds

```powershell
npm test
npm run lint
npm run build
cd backend\goengine
go test ./...
go build -o engine-check.exe ./cmd/engine
Remove-Item engine-check.exe
```

The Electron package is built with `npm run build:electron`. Build outputs
(`apps/desktop/dist`, `apps/desktop/electron-dist`, release packages, and
compiled engines) are generated artifacts and should not be edited manually.

## Runtime data

The default persistent data directory is the operating-system user config
directory under `AI Server Studio\data`. Electron explicitly sets
`AI_SERVER_DATA_DIR` to `<Electron userData>\data`. Standalone engine launches
can override it with `AI_SERVER_DATA_DIR`.

SQLite is stored as `studio.sqlite`. Legacy agent-run JSON files are imported
from `agent-runs` into SQLite with migration backups. Logs and generated
artifacts belong in the runtime data directory, not in source directories.
Provider credentials are handled by the existing protected secret mechanism;
do not commit `.env` files or credentials.

## Troubleshooting

- If Electron cannot start the engine, verify `backend\goengine\engine.exe`
  exists or set `AIST_DEV_ENGINE_FROM_SOURCE=1` and confirm the Go/CGO
  toolchain is available.
- If the API port is busy, the engine automatically selects a nearby free
  port and reports it to Electron.
- If persistence fails, inspect the configured `AI_SERVER_DATA_DIR` and run
  the backend persistence tests before touching legacy data.
- Supabase files are retained for migration and deployment compatibility; they
  are not required for local desktop startup.
