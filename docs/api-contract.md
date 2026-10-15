# AI Server Studio — Agent and Tool API Contract

All endpoints are under the existing `/v1` prefix and are served by the local
Go gateway. Existing authentication middleware remains responsible for
protected routes.

## Agent runs

### Create a run

```http
POST /v1/agent/runs
Content-Type: application/json
```

```json
{
  "goal": "Summarize the project",
  "modelName": "local-model",
  "sessionId": "chat-123",
  "executionMetadata": {"source": "chat"},
  "maxSteps": 8,
  "maxIterations": 20,
  "executionMode": "online",
  "provider": {
    "id": "local",
    "name": "Local Server",
    "baseUrl": "http://localhost:1234/v1"
  },
  "tools": []
}
```

The response remains compatible with the existing client:

```json
{"id":"run-...","status":"running"}
```

### Read a run

```http
GET /v1/agent/runs/{id}
```

The response includes the run snapshot, ordered `events`, and the latest
`checkpoint`. Historical snapshots remain available after a backend restart.

### Stream and replay events

```http
GET /v1/agent/runs/{id}/events?cursor=14
Last-Event-ID: 14
Accept: text/event-stream
```

If both cursor forms are supplied, `Last-Event-ID` takes precedence. The
server emits all events with a sequence greater than the cursor, followed by
live events. A terminal run closes the stream after its final event.

```text
id: 15
data: {"sequence":15,"type":"agent_done","timestamp":1720000000000,"data":{"answer":"done"}}
```

### Cancel a run

```http
POST /v1/agent/runs/{id}/cancel
```

Cancellation is persisted before the response is returned. Repeated
cancellation of an already terminal run is an idempotent success. A late
completion cannot overwrite a committed cancellation.

## Tools

### Discover registered tools

```http
GET /v1/tools
```

```json
{
  "data": [
    {
      "name": "web.fetch",
      "description": "Fetch readable text from a public HTTPS URL.",
      "inputSchema": {"type":"object"},
      "capabilities": ["net:http"],
      "requiresApproval": false,
      "enabled": true
    }
  ]
}
```

### Execute a registered tool

```http
POST /v1/tools/execute
Content-Type: application/json
```

```json
{"tool":"web.fetch","args":{"url":"https://example.com"}}
```

Unknown or disabled tools are rejected before execution. The legacy names
`web-search` and `url-fetch` remain accepted as aliases during migration.

## Compatibility notes

- Existing `/v1/agent/chat` remains unchanged.
- Existing run event names remain supported: `plan_created`, `step_started`,
  `step_observation`, `step_done`, `agent_done`, and `agent_error`.
- Older clients may ignore `sequence`, `checkpoint`, and SSE `id` fields.
- Clients that reconnect should use the last accepted sequence as `cursor`.

## Optional tunnel controls

These routes are desktop-session protected and are never registered on the
public tunnel listener:

```text
GET  /v1/tunnel/status
POST /v1/tunnel/start
POST /v1/tunnel/stop
```

They report only provider, running state, and an observed public URL. They do
not return tunnel credentials.
