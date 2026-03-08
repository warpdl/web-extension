# WebSocket Migration Design

## Problem

The extension currently uses HTTP POST JSON-RPC 2.0 with Bearer token auth to communicate with the daemon. The user wants to use the daemon's existing unauthenticated WebSocket endpoint at `ws://localhost:<port>/` instead.

## Decision

Use **Approach A**: connect to the root WebSocket endpoint (`/`) on the daemon. This endpoint:

- Requires no authentication
- Accepts raw JSON messages (not JSON-RPC 2.0)
- Already exists in the daemon — no daemon changes needed

## Daemon Protocol (root `/` WebSocket)

**Message format** (`capturedDownload`):

```json
{
  "url": "https://example.com/file.zip",
  "headers": [
    {"key": "User-Agent", "value": "..."},
    {"key": "Cookie", "value": "a=1; b=2"}
  ],
  "cookies": [
    {
      "Name": "session",
      "Value": "abc123",
      "Domain": ".example.com",
      "Path": "/",
      "HttpOnly": true,
      "Secure": false
    }
  ]
}
```

Key details:
- `headers`: `{key, value}[]` (lowercase JSON keys, matching `warplib.Header`)
- `cookies`: `http.Cookie[]` (Go struct field names: `Name`, `Value`, `Domain`, `Path`, `HttpOnly`, `Secure`, `Expires`, `MaxAge`, `SameSite`)
- No response is sent back from the daemon on this endpoint
- The daemon port is configurable; the WebSocket URL is `ws://localhost:<port>/`
- Default daemon port: **3850** (the WebServer listens on port+1 from the IPC port, but the user-facing default is 3850)

## Changes Required

### Remove
- `src/jsonrpc.ts` — no longer needed (JSON-RPC not used)
- Bearer token auth field from popup
- JSON-RPC types from `src/types.ts`
- `PING` / `GET_STATUS` message handling (no daemon response on this endpoint)

### Modify
- `src/types.ts` — remove JSON-RPC types, fix header key casing (`key`/`value` not `Key`/`Value`), add proper Cookie type matching Go's `http.Cookie`
- `src/settings.ts` — remove `authToken` field
- `src/service_worker.ts` — replace `JsonRpcClient` with a WebSocket client that sends raw JSON; remove message-based ping/status; format cookies as `http.Cookie` objects
- `src/popup.ts` — remove auth token field; connection status based on WebSocket readyState; test connection by checking if WebSocket is open
- `public/popup.html` — remove auth token input
- `src/content_script.ts` — no changes needed
- `src/youtube_content.ts` — no changes needed
- `src/youtube_main_world.ts` — no changes needed

### WebSocket Client Design

```
class DaemonSocket {
  - url: string (ws://localhost:3850)
  - socket: WebSocket | null
  - reconnect timer with backoff

  connect(): opens WebSocket
  send(data: CapturedDownload): JSON.stringify and send
  isConnected(): boolean (readyState === OPEN)
  disconnect(): close socket
  onStatusChange(cb): notify popup of connect/disconnect
}
```

Auto-reconnect on disconnect with exponential backoff (1s, 2s, 4s... max 30s).

### Popup Changes

- Remove auth token field
- "Test Connection" becomes implicit — status dot reflects live WebSocket state
- Keep daemon URL field (just the host:port, extension builds `ws://` URL)
- Keep intercept toggle

### Message Flow

Content scripts and popup still use `chrome.runtime.sendMessage` to talk to the service worker. The service worker holds the WebSocket connection and forwards download requests to the daemon.
