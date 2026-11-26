# Security boundary

- Provider credentials are backend-owned and renderer responses expose only
  metadata such as `has_key`.
- Offline mode blocks network-bound tools; online access is explicit.
- URL and MCP destinations retain HTTPS, loopback and SSRF checks.
- Sandbox execution never treats a Go goroutine, Node VM or restricted Python
  built-ins as isolation. It fails closed unless an explicitly configured
  isolated worker is available, and bounds code, output, timeout and
  concurrency.
- RAG documents, chunks and vectors are owner-scoped in SQLite.
- Portable paths reject traversal/link escapes and keep SQLite, logs, models,
  temporary files and backups under the selected root.
