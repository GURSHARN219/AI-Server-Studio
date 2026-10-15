# Security boundaries

- The Go gateway authenticates protected routes and enforces owner isolation.
- Renderer storage contains session/UI state only; provider keys are not
  forwarded to external hosts.
- Electron supplies runtime data paths explicitly and does not automatically
  import `.env` files.
- SQLite files and logs are created under the user data directory with
  restrictive permissions where the platform permits them.
- The Supabase functions remain separate legacy deployment code and are not
  trusted by the local renderer.
