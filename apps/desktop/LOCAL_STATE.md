# Local runtime/state migration

The Go engine's authenticated SQLite APIs are authoritative. The renderer has no Supabase runtime import or cloud-environment requirement. Provider responses contain metadata and `has_key`; their `api_key` is empty. Configuration accepts a new key once, while execution sends saved provider IDs only.

## Active state inventory

- Chat tabs/messages/active tab: `GET/PUT /v1/conversations/state`.
- Appearance, chat, advanced, about settings and account preferences (provider model selections, tools/version, basic/API/path settings, media selections, TTS presets): `GET/PUT /v1/settings/user`.
- Providers, MCP servers, API keys, knowledge-base documents and usage: authenticated Go resources.
- `ai-server-auth-token`: local session bearer only; never forwarded to external hosts or engine redirects.
- `ai-server-pending:<owner>:<resource>`: temporary owner-scoped outbox for debounced/failed UI-state writes. Contains UI data, no session bearer or provider configuration keys; deleted after acknowledgment. Recovered only after that owner is authenticated and server state has been read.
- `ai-server:downloads` (download manager's transient progress cache), `ai-server-force-offline`, `ai-server-theme`, `ai-server-chat-sessions-open`: installation UI/device state, not account chat/settings authority.

## Legacy sources

Shared `ai-server-chat-storage` is read only after Settings → Chat → **Import legacy chats into this account…** and explicit target-account confirmation. Its contents are hashed for a stable `source_id` and submitted to the owner-scoped idempotent import API; the source is not deleted. Legacy provider credentials, installation encryption keys, shared tool/MCP configuration and prior settings are not automatically read, decrypted, assigned or uploaded.

## Desktop startup

Both development and packaged Electron launches explicitly set `AI_SERVER_DATA_DIR` to `app.getPath('userData')/data`, unless a launching-environment override is supplied. The legacy engine-config import is disabled. Electron no longer automatically reads `.env`/`.env.local`, and its startup hook does not require pgvector. Missing optional Aistclaw source/binaries do not block the Studio engine. Packaged binary paths follow the `engine/` and `backend/` extra-resource directories. Shutdown sends termination and waits up to three seconds before forced termination; development uses the freshly built engine binary by default rather than leaving a `go run` child behind.
