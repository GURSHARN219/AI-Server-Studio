# Local RAG embedding provider

Semantic RAG is offline-first and disabled unless all required provider
settings are valid. The OpenAI-compatible endpoint must be local loopback
(`localhost`, `127.0.0.1`, or `::1`); proxy use and HTTP redirects are disabled.
No model or provider is downloaded automatically.

Set these environment variables before starting the server:

| Setting | Required | Meaning |
| --- | --- | --- |
| `AIST_RAG_EMBEDDING_BASE_URL` | yes | Local provider base URL, for example `http://127.0.0.1:8080/v1` |
| `AIST_RAG_EMBEDDING_MODEL` | yes | Provider model identifier sent in `/embeddings` requests |
| `AIST_RAG_EMBEDDING_DIMENSIONS` | yes | Positive integer expected in every returned vector |
| `AIST_RAG_EMBEDDING_VERSION` | yes | Stable application/provider index version; changing it requires reindexing |
| `AIST_RAG_EMBEDDING_API_KEY` | no | Optional bearer token for the local endpoint |

Requests are bounded by a 10-second HTTP timeout and a 1 MiB response-body
limit. Response vectors must be finite, nonzero, and exactly the configured
dimension. An invalid or incomplete configuration leaves ordinary server
startup available but reports RAG as unavailable.

`PATCH /v1/rag/documents/{id}` accepts `{ "reindex": true }` with no document
fields to explicitly reindex one owned document atomically. Embedding calls
run before the database write transaction; failures or cancellation preserve
the prior chunks. Existing rows from pre-version migrations are retained but
search returns an explicit incompatible-index error until they are reindexed.
