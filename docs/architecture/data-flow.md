# Data flow

1. The Go entrypoint resolves one portable root and opens the authenticated
   local API.
2. The browser loads the embedded React bundle from the same origin. Vite
   proxies `/v1`, `/health` and streaming routes during development.
3. Authenticated requests enter `server`, where owner scope, execution mode,
   capability policy and request bounds are checked before side effects.
4. Agent and workflow state is committed to SQLite before SSE subscribers are
   notified. Cursors permit replay after reconnect.
5. Model calls remain behind `engine`; sandbox calls require verified process
   isolation; RAG calls require an embedding provider and persist vectors in
   the local RAG index.
