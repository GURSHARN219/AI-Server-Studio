# Architecture overview

AI Server Studio is a local-first modular Go application:

```text
Browser / embedded UI (Vite HMR is separate development tooling)
        │ same-origin HTTP + SSE
        ▼
cmd/engine ── server ── auth / routes / events
        ├── engine       native model loading and inference
        ├── tools        capability registry and adapters
        ├── sandbox      fail-closed isolated worker boundary
        ├── rag          documents, chunks, embeddings, vector ranking
        ├── workflow      durable DAG execution and recovery
        └── persistence   SQLite, migrations and portable data
```

Production React assets are embedded from `app/dist`. With no CLI arguments,
the same Go process binds the API, serves the embedded UI and opens the actual
listener URL after readiness. `--server` uses the same process in strict
API-only mode: it does not open a browser and does not register frontend routes.
Vite is a separate development command and is never started by the production
executable.
