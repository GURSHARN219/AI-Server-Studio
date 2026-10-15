# Optional remote API access

Local-only mode is the default. The Go API binds to loopback, and no tunnel or
inbound router port is opened automatically.

## Public listener

Set `AI_SERVER_PUBLIC_PORT` to a free local port to expose only the restricted
external API handler on loopback. The public handler accepts API-key
authentication and an explicit allowlist for model discovery and chat
completion routes. Browser sessions and administrative routes are rejected.

```text
AI_SERVER_PUBLIC_PORT=14567
```

The private desktop API continues to use its normal dynamically selected port.

## Supported tunnel clients

The Go engine provides a small process adapter for installed `ngrok` and
`cloudflared` clients. It does not implement a custom tunnel protocol and does
not receive or persist provider credentials.

```text
AI_SERVER_PUBLIC_PORT=14567
AI_SERVER_TUNNEL_ENABLED=1
AI_SERVER_TUNNEL_PROVIDER=ngrok       # or cloudflare
# optional executable override:
# AI_SERVER_TUNNEL_COMMAND=C:\\path\\to\\ngrok.exe
```

Provider credentials must be configured through the provider's supported local
credential store or environment mechanism. They are never logged, returned by
`/v1/tunnel/status`, or sent through the renderer.

When enabled, the engine starts the selected client against
`http://127.0.0.1:<public-port>`, reports a discovered HTTPS URL when the
client prints one, and treats client failure/disconnection as a non-fatal
condition. The local API remains available.

Authenticated desktop-only controls are available at:

```text
GET  /v1/tunnel/status
POST /v1/tunnel/start
POST /v1/tunnel/stop
```

These controls are not reachable through the public tunnel handler.

Remote operation depends on the computer remaining online and the selected
client being installed/configured. A missing client or credential produces an
actionable status/error; it is never reported as active without a running
process and observed provider URL.
