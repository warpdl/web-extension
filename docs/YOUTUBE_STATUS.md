# YouTube Integration — Current Status

**Last updated:** 2026-04-23
**Branch:** `ws-hardening`

## What works

- Generic `<video src>` detection on any non-YouTube site — direct URL overlay + download
- YouTube detection (finds `#movie_player`, mounts overlay)
- YouTube `ytInitialPlayerResponse` extraction
- YouTube `base.js` fetch + cache
- URL capture in background via `chrome.webRequest.onBeforeRequest` (sees all googlevideo.com requests including those from YouTube's Service Worker)
- Graceful degradation: overlay stays in "Detecting…" state when decoders unavailable rather than erroring

## What does not work

### Signature decoder (regex-based extraction from base.js)

Our regex patterns — based on yt-dlp's historical patterns — do not match modern YouTube base.js (as of player hash `1bb6ee63`, April 2026). YouTube has moved past the classic `var FN=function(a){a=a.split("");...return a.join("")}` shape. Zero out of seven signature-name patterns match; same for n-param patterns.

### SABR stream protocol (observed in live traffic)

YouTube now uses **Server-Aided Buffered Range** for segment fetches:

- Every segment request is a `POST` to `/videoplayback?...&sabr=1&...`
- The URL has `sig=...` and `n=...` ALREADY APPLIED (YouTube decoded them)
- **But `itag` is in the POST body, not the URL** — encoded as protobuf
- A `GET` request to the same URL does not stream the media directly; the server expects a SABR body

Our background `webRequest` listener with `requestBody` flag captures these URLs + bodies. A heuristic protobuf scan extracts itag (field 2, varint) — best effort, unreliable.

### Why in-extension YouTube URL resolution is a losing battle

- YouTube changes base.js obfuscation every 1-4 weeks
- YouTube invented SABR specifically to make client-side URL construction harder
- yt-dlp has 200+ contributors tracking YouTube changes; each release is weeks of reverse engineering
- Even IDM (Internet Download Manager) does **not** solve this in-extension — see next section

## What IDM actually does

IDM's Chrome extension (`llbjbkhnmlidjebalopleeepgdfgcpec`) has:

- `background.js` — 130 lines
- `content.js` — 55 lines
- **Zero YouTube-specific code** in either file

The entire extension is a thin shim that calls `chrome.runtime.connectNative("com.tonec.idm")` to communicate with `idman.exe` — IDM's native Windows application. All URL resolution, signature decoding, SABR handling, and DASH stream merging happens in the native binary. The extension just:

1. Watches for `<video>` elements
2. Extracts `ytInitialPlayerResponse` and page metadata
3. Forwards to native app
4. Native app returns download info
5. Extension shows download button

When YouTube changes, IDM ships an update to `idman.exe`. The extension itself never changes.

## Recommended path forward

WarpDL already has a daemon — it is our `idman.exe` equivalent. Mirror IDM's architecture:

### Daemon-side (WarpDL daemon, Go)

Add one new RPC endpoint:

```
Request:  { type: "resolve_url", url: "https://youtube.com/watch?v=..." }
Response: { formats: [{ itag, quality, mime, size, url, file_name }, ...] }
```

Implementation options in priority order:

1. **Shell out to yt-dlp** (1-2 days)
   ```
   yt-dlp --dump-json --no-warnings <url>
   ```
   Parse the JSON, return the `formats` array. yt-dlp is already installed on this user's system (`/usr/bin/yt-dlp`). Easy ship; correctness-at-no-cost.

2. **Embed a Go YouTube library** (1 week)
   - `kkdai/youtube` (most popular)
   - `lrstanley/go-ytdlp` (wraps yt-dlp binary in Go)
   - Ships with the daemon, no system dependency.

3. **Port yt-dlp signature logic to Go** (weeks, ongoing maintenance)
   Not recommended. Re-deriving patterns every time YouTube rotates.

### Extension-side (this repo)

Replace the in-extension YouTube pipeline:

- Remove: `signature.ts`, `url_sniffer.ts`, `player_hook.ts`, `base_js_loader.ts`, `yt_url_capture.ts`
- Keep: `player_data.ts` (we still extract `videoId` from page), `detector.ts`, `main_world.ts`, `content_main.ts`, `formats.ts`
- Add: new bridge that sends the YouTube URL to the daemon via the existing WebSocket connection, receives the formats array, builds `OverlayOption[]` from it.

Net code change: delete ~1200 lines from the extension, add ~100 lines of daemon-forward logic. Delete ~380 tests.

### Scope note

The WebSocket hardening work built a solid daemon client infrastructure (`core/`, `daemon/`, `messaging/`). Adding a new "resolve_url" RPC is additive and should not disturb download flows.

## What to do right now

Pick one:

1. **Implement option B on the daemon** (recommended). Daemon is a separate repo — this extension branch can merge as-is, YouTube work ships when daemon implements `resolve_url`.
2. **Ship what we have** (YouTube partially works for direct-URL formats; HD won't decode). The extension works for generic `<video>` sites. Users who want YouTube HD install yt-dlp separately.
3. **Keep chasing regex patterns in the extension** (not recommended — burn rate is high, reward is low).

No code changes are required to "ship what we have" today.
