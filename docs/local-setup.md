# Local setup and portable runtime

## Development

From `app`:

```text
npm install
npm run dev
```

Build the production UI and run the single Go GUI + API process:

```powershell
npm --prefix app run build
go run ./cmd/engine
```

For frontend-only HMR development, keep Vite separate:

```powershell
npm run dev
```

The Go application resolves the portable root and serves the API and UI from a
single process. It does not require Supabase variables, a cloud database,
pgvector or a tunnel for local startup.

Use `go run ./cmd/engine --server` for API-only operation. Supported runtime
flags are `--port`, `--model`, `--models-dir`, `--cpu`, and `--ctx`; `--vllm`
requires `--server`. With no arguments, the Go process serves the embedded
production UI and opens the actual listener URL after readiness. API-only mode
does not register frontend routes. Vite HMR is intentionally a separate
development command and is not a production CLI mode.

For a standalone Go engine, set `AIST_PORTABLE_ROOT` to a private writable
portable directory. The engine will create the directory with private
permissions and run migrations before accepting requests. `AI_SERVER_DATA_DIR`
may be used as a development override only when it is inside the selected
portable root; it is never used to escape that root.

Packaged portable launch from PowerShell:

```powershell
$env:AIST_PORTABLE_ROOT = (Resolve-Path .).Path
& ".\AI Server Studio.exe"
```

Moving the complete application directory, including `data`, preserves the
configuration. Relative model references remain relocatable. An explicitly
selected absolute GGUF path on another drive is retained and is not copied,
deleted, or rewritten by the application.

## External providers

Configure provider metadata through the Settings UI. Submit a provider key
only when creating or replacing a provider credential. The renderer receives
`has_key` metadata, never the usable key. The backend stores the credential in
the OS-backed secret store (Windows DPAPI) or requires an externally supplied
AES-GCM key on non-Windows systems.

## External API keys

Create an API key from the API Gateway page. The complete key is shown once.
Store it in the calling application's secret manager; later list responses
contain only metadata. Revoke or expire keys from the authenticated desktop
session. Public/tunnel access is disabled unless explicitly configured.

## Data migration

The SQLite migration is intentionally conservative:

- agent-run JSON import requires an explicit owner map;
- chat import requires explicit confirmation in the UI;
- provider/API-key plaintext is not silently re-used or copied;
- legacy files remain as source/reference material after verification;
- backups are private and never overwrite an existing snapshot.

See [`storage-inventory.md`](storage-inventory.md) for the complete mapping.
