# AI Server Studio architecture diagrams

These are target-state diagrams, not a claim that all features are implemented. Nodes marked LATER PHASE (yellow) are future architecture.

- `00-overview.mmd` — system overview
- `01-entrypoints-auth.mmd` — local session, public API-key, webhook isolation, approval route, job-creation scope
- `02-execution-policy.mmd` — policy before dispatch, blocked_policy, approvals, GPU queue, retry, recovery
- `03-scheduler-desktop.mmd` — Electron lifecycle, backend identity check, catch-up, job versions, tray and autostart
- `04-memory-skills-tools.mmd` — five memories, secret filter, authoritative skill versions, tools/MCP with SSRF check
- `05-capabilities.mmd` — local/provider routing, no fallback, VoiceStudio and ComfyUI behind adapters
- `06-channels.mmd` — gated external delivery with approval; local notifications always allowed
- `07-observability-storage.mmd` — one-transaction history, redaction, usage and secrets
- `08-rollout-phases.mmd` — per-phase gates and deferred work

Render each `.mmd` file with Mermaid. All diagrams are standalone and were render-checked with mermaid-cli 11.4.2.

Invariants:
- Offline is the default; connectivity is only `offline` or `online`; there is no `auto`.
- No silent local-to-provider fallback. A blocked run stays blocked until an explicit retry, which revalidates everything.
- All dispatch goes through current policy.
- Principals are `session`, `api_key`, `webhook` or `scheduler`.
- Approvals come only from an interactive UI session and trigger a fresh policy check; expired or rejected approvals cancel the run.
- `task_runs` is the canonical state. The state change, its `run_events` record and any `execution_events` record commit in one SQLite transaction; SSE is notified after commit.
- GPU eligibility is derived from `task_runs`; waiting jobs go oldest first.
- Claimed scheduled occurrences keep their original job version and `scheduled_for_utc`.
- Secrets are accessed only through SecretStore and never written to memory or logs.
- Analytics APIs enforce owner scoping.
