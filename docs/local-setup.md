# Local setup after SQLite migration

## Development

From `apps/desktop`:

```text
npm install
npm run build:engine:dev
npm run dev:electron
```

The Electron process supplies `AI_SERVER_DATA_DIR` automatically. The Go
engine creates `studio.sqlite` under the Electron user-data directory and
does not require Supabase variables, a cloud database, pgvector, or a tunnel.

For a standalone Go engine, set `AI_SERVER_DATA_DIR` to a private writable
directory outside the repository. The engine will create the directory with
private permissions and run migrations before accepting requests.

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
