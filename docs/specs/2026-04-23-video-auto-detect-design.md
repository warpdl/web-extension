# Video Auto-Detection & IDM-Style Overlay — Design

**Date:** 2026-04-23
**Status:** Draft — pending user review
**Approach:** Modular detector architecture (Approach B from brainstorming)

---

## 1. Goal

Auto-detect videos on any webpage and surface a persistent, IDM-style "Download with WarpDL" button overlaid on the video. For YouTube, resolve all streaming qualities (including those protected by `signatureCipher` and `n`-parameter throttling) so users can pick resolution/codec from a dropdown — matching IDM's behavior.

### 1.1 In scope

- **Always-visible overlay button** on detected videos (top-right of the video, IDM-style).
- **Generic `<video>` detection**: direct `src` / `<source>` / `currentSrc`, same as today. Now surfaced through the new overlay with consistent UX.
- **YouTube signature + n-parameter decoding in-extension**: fetch `base.js`, extract decoder functions, apply them to all formats to unlock 1080p+ qualities.
- **SPA-aware**: YouTube client-side navigation updates the overlay options without re-mounting.
- **Testable architecture**: pure signature-extraction logic against archived `base.js` fixtures so future YouTube changes land as one-file patches.
- **Daemon unchanged**: extension sends fully-decoded URLs over the existing WebSocket contract.

### 1.2 Out of scope (explicit)

- HLS (`.m3u8`) and DASH (`.mpd`) stream parsing.
- DRM'd streams (Netflix, Prime Video, etc.) — not bypassable.
- Videos inside cross-origin iframes (content script runs in each frame context today, but the overlay only appears where the video element is; we do not cross iframe boundaries).
- YouTube Music, YT Kids, or Shorts-specific UX tweaks (they work incidentally as long as `#movie_player` exists).
- Vimeo, Twitch, Twitter/X, TikTok, and other platforms (future detectors can slot into the architecture).
- Daemon-side streaming manifest handling or yt-dlp integration.
- Batch "download all qualities" (IDM's top-of-dropdown option) — YAGNI for v1; easy to add later.
- Last-used quality persistence.

---

## 2. Current state

| File | Purpose | Keep / replace |
|---|---|---|
| `src/content_script.ts` | Generic `<video>` overlay (hover-only, no format picker) | Replace (logic moves to `GenericDetector` + shared `Overlay`) |
| `src/youtube_content.ts` | YouTube button in the **action bar** with basic format picker (drops signatureCipher formats) | Replace (becomes `YouTubeDetector`, overlay moves onto the video) |
| `src/youtube_main_world.ts` | Extracts `ytInitialPlayerResponse` | Replace (split into `player_data.ts` + `main_world.ts` + new signature/base.js modules) |
| `public/manifest.json` | 3 content-script declarations | Unchanged |

Modules created by the WebSocket hardening pass (`src/core/`, `src/daemon/`, `src/downloads/`, `src/messaging/`, `src/capture/`) are not touched by this work.

---

## 3. Architecture

### 3.1 Module layout

```
src/
├─ detect/
│  ├─ overlay.ts                     # IDM-style button + dropdown UI (no site knowledge)
│  ├─ detector.ts                    # Abstract Detector + BaseDetector
│  ├─ content_main.ts                # Isolated-world entry: picks detector by hostname
│  └─ detectors/
│     ├─ generic.ts                  # <video src> / <source> / currentSrc detector
│     └─ youtube/
│        ├─ detector.ts              # Isolated world: bridge + overlay mount
│        ├─ main_world.ts            # Main world entry: orchestration + postMessage bridge
│        ├─ player_data.ts           # Main world: extract ytInitialPlayerResponse
│        ├─ base_js_loader.ts        # Main world: fetch + cache base.js by player hash
│        ├─ signature.ts             # Main world: parse base.js → extract decoder functions
│        └─ formats.ts               # Pure: raw formats → OverlayOption[]
├─ types.ts                          # (extend) VideoFormat, YtBridgeMessage, YtExtractError
├─ service_worker.ts                 # unchanged
├─ popup.ts                          # unchanged
├─ core/ · daemon/ · capture/ ...    # unchanged
```

Three existing webpack entry points repurposed:

| Entry | Imports | World | Match (manifest) |
|---|---|---|---|
| `content_script` | `src/detect/content_main.ts` | ISOLATED | `<all_urls>`, excludes youtube.com |
| `youtube_content` | `src/detect/content_main.ts` | ISOLATED | `*://*.youtube.com/*` |
| `youtube_main_world` | `src/detect/detectors/youtube/main_world.ts` | MAIN | `*://*.youtube.com/*` |

`content_main.ts` picks the right detector from `location.hostname`. No code duplication between `content_script` and `youtube_content` entries.

### 3.2 Dependency rules

- `overlay.ts` depends only on DOM. Never imports from `detectors/`.
- `detector.ts` defines the interface + base class. Never imports concrete detectors.
- `detectors/generic.ts` imports `overlay.ts` and `detector.ts`.
- `detectors/youtube/` subtree: the main-world and isolated-world halves never share imports; the main-world bundle never imports `overlay.ts` or anything under `isolated-world` subtree, and vice versa. Shared types live in `src/types.ts`.
- `content_main.ts` imports concrete detectors and picks one.

### 3.3 Two-world split (main ↔ isolated)

```
┌──────────────────────────────────────────────────────────────┐
│ MAIN world (page JS context, can use new Function / eval)    │
│                                                              │
│    player_data   base_js_loader   signature   formats        │
│                       │                                      │
│                       ▼                                      │
│                  main_world.ts                               │
│                       │                                      │
│       window.postMessage({ source: 'warpdl-yt-main', ... })  │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ ISOLATED world (extension content script, CSP disallows eval)│
│                                                              │
│   youtube/detector.ts ←→ overlay.ts (DOM mount)              │
│         │                                                    │
│         ▼                                                    │
│   chrome.runtime.sendMessage({ type: 'DOWNLOAD_VIDEO', ... })│
└───────────────────────────┬──────────────────────────────────┘
                            ▼
                  Service Worker (unchanged)
```

Why `new Function()` lives in the main world: MV3 isolated-world CSP forbids dynamic code evaluation. The main world runs under the *page's* CSP (permissive on `youtube.com`), so it can execute YouTube's extracted decoder JS. The page can already execute that same code — we gain nothing by shielding ourselves from it.

### 3.4 Bridge protocol

All cross-world messages are namespaced + type-discriminated:

```ts
export type YtBridgeMessage =
  // isolated → main
  | { source: "warpdl-yt-content"; type: "request-formats" }
  | { source: "warpdl-yt-content"; type: "ping" }
  // main → isolated
  | { source: "warpdl-yt-main"; type: "ready" }
  | { source: "warpdl-yt-main"; type: "formats-ready"; options: OverlayOption[]; videoId: string; title: string }
  | { source: "warpdl-yt-main"; type: "formats-error"; reason: YtExtractError; videoId: string | null };

export type YtExtractError =
  | "no_player_response"
  | "no_formats"
  | "base_js_fetch_failed"
  | "signature_extract_failed"
  | "n_extract_failed"
  | "decode_exception"
  | "unknown";
```

Every receiver filters on both `ev.source === window` (message originates from the same window, not an iframe) AND `ev.data.source === "<expected namespace>"`. This prevents hijack by page scripts and by other extensions.

---

## 4. Overlay UI (`src/detect/overlay.ts`)

### 4.1 Public API

```ts
export interface OverlayOption {
  label: string;           // "720p · video/mp4 · 42.3 MB"
  sublabel?: string;       // "video only"
  url: string;
  fileName?: string;
  group?: string;          // "Combined" | "Video only" | "Audio only"
}

export interface OverlayHandle {
  setOptions(options: OverlayOption[]): void;   // replace list live (SPA nav)
  destroy(): void;                              // unmount + cleanup listeners
}

export function mountOverlay(deps: {
  video: HTMLVideoElement;
  options: OverlayOption[];
  onSelect: (opt: OverlayOption) => void;
}): OverlayHandle;
```

One function, one data shape, one handle. No site state.

### 4.2 Layout & behavior

- **Position:** 12 px from top + right edge of the video (or of the parent containing the video, whichever is positioned). Wraps the parent in `position: relative` only if it isn't already positioned.
- **Persistence:** always visible from mount. Options empty → button shows "Detecting…" spinner; options populated → "⬇ WarpDL ▾".
- **Dropdown:** opens on click. Click outside closes. Options grouped by `group` property; group headers render as small caps. Click on option → `onSelect(option)` + dropdown closes.
- **Fullscreen:** `fullscreenchange` listener re-parents the overlay into the current `document.fullscreenElement` so it stays visible when the player goes fullscreen.
- **Resize:** `ResizeObserver` on the video keeps overlay positioned correctly in theater / mini-player modes.
- **Compact mode:** if video < 200×100 px, overlay uses an icon-only button; dropdown appears adjacent rather than below.
- **Z-index:** `2147483647`.
- **Styles:** inline, dark palette matching the popup. No external stylesheet (survives page CSS resets).

### 4.3 File size target

~250 lines. Easy to hold in context, straightforward to unit-test.

### 4.4 Tests (jsdom)

- Mount with empty options → button shows "Detecting…" state
- `setOptions(...)` replaces dropdown content without remount
- Click button → dropdown toggles; click outside → closes
- Option click → invokes `onSelect` with the right object
- Grouped options render group headers
- `destroy()` removes nodes and listeners (verified via `removeEventListener` spies)
- Fullscreen re-parent (mock `document.fullscreenElement`)
- Compact mode triggers below 200×100 px

---

## 5. Detector contract

### 5.1 Interface and base class

```ts
export interface Detector {
  start(): void;
  stop(): void;
}

export abstract class BaseDetector implements Detector {
  protected handles = new Map<HTMLVideoElement, OverlayHandle>();
  private observer: MutationObserver | null = null;

  start(): void { /* scan + MutationObserver + onStart() */ }
  stop(): void { /* disconnect + unmount all + onStop() */ }

  protected abstract shouldHandle(video: HTMLVideoElement): boolean;
  protected abstract getOptions(video: HTMLVideoElement): OverlayOption[] | Promise<OverlayOption[]>;

  protected onStart(): void {}
  protected onStop(): void {}

  protected async refresh(video: HTMLVideoElement): Promise<void> {
    const h = this.handles.get(video);
    if (!h) return;
    h.setOptions(await this.getOptions(video));
  }

  protected onUserPick(video: HTMLVideoElement, option: OverlayOption): void {
    chrome.runtime.sendMessage({
      type: "DOWNLOAD_VIDEO",
      url: option.url,
      fileName: option.fileName,
      pageUrl: window.location.href,
    });
  }
}
```

Concrete detectors override `shouldHandle` and `getOptions`. Lifecycle hooks (`onStart`/`onStop`) are opt-in.

### 5.2 `GenericDetector`

- `shouldHandle`: true iff `video.src` / `<source src>` / `currentSrc` yields a non-`blob:` URL.
- `getOptions`: returns one option `{ label: "Download video", url: <src> }`.
- ~20 lines of concrete code.

### 5.3 `YouTubeDetector` (isolated-world)

- `onStart`: registers a `window.addEventListener("message", ...)` listener to receive main-world bridge messages. Sends initial `{ type: "request-formats" }` to the main world.
- `shouldHandle`: true iff `video.id === "movie_player"` OR `video.closest("#movie_player") !== null`. Prevents mounting on tiny preview thumbnails.
- `getOptions`: returns the most recent `formats-ready.options` cached from the main world; empty array until first message lands. Overlay spinner shows during the wait.
- On `yt-navigate-finish`-triggered `formats-ready` message: calls `this.refresh(video)` for each handled video, which invokes `setOptions()` on the overlay.
- `onStop`: removes the message listener.

### 5.4 `content_main.ts`

```ts
function pickDetector(): Detector {
  const host = location.hostname;
  if (host === "www.youtube.com" || host.endsWith(".youtube.com")) {
    return new YouTubeDetector();
  }
  return new GenericDetector();
}

const detector = pickDetector();
const boot = () => detector.start();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
window.addEventListener("pagehide", () => detector.stop());
```

---

## 6. YouTube main-world pipeline

### 6.1 Startup sequence

```
MAIN (main_world.ts)                    ISOLATED (youtube/detector.ts)
─────────────────────                   ───────────────────────────────

on DOMContentLoaded:
  listen for 'yt-navigate-finish'
  send { type: "ready" }  ───────────────► mount YouTubeDetector
                                            listen for messages
                                            scan for video#movie_player:
                                              mount Overlay with options=[]
                                              send { type: "request-formats" } ──►
                                    ◄──
  on "request-formats":
    playerResponse = getPlayerResponse()
    if (!playerResponse):
      send { type: "formats-error", reason: "no_player_response" }  ─────►
                                                                           overlay.setOptions([])
                                                                           + show "No formats found"
    baseJs = await loadBaseJs()  (cached)
    decoders = extractDecoders(baseJs)
    options = buildOptions(playerResponse, decoders)
    send { type: "formats-ready",
           options, videoId, title }  ──────────────────────────────────►
                                                                           overlay.setOptions(options)

on 'yt-navigate-finish':
  wait 500ms
  re-extract playerResponse
  re-build options (baseJs cached)
  send { type: "formats-ready", ... } ──────────────────────────────────►
                                                                           overlay.setOptions(newOptions)
```

Decoding is lazy: we don't touch base.js until the overlay asks. On SPA nav we re-run extraction but the cached base.js usually still applies (YouTube rotates player hash ≪ once per day).

### 6.2 `player_data.ts`

Three extraction strategies, tried in order:

1. `window.ytInitialPlayerResponse` global.
2. Regex over `<script>` text content: `/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s`.
3. `document.getElementById("movie_player").getPlayerResponse()` if the player object exposes the helper.

First hit wins. Returns `PlayerResponse | null`. Pure string/DOM parsing — no network.

### 6.3 `base_js_loader.ts`

```
1. Find base.js URL:
   - Look for ytcfg.data_['PLAYER_JS_URL'] in the page (main-world access).
   - Fallback: scan <script src="...base.js"> tags.
2. Normalize to absolute URL.
3. Extract player hash from URL: /s/player/<hash>/player_ias.vflset/en_US/base.js
4. Cache check:
   - In-memory (module-scoped Map<hash, string>).
   - chrome.storage.local["yt_base_js:" + hash] — text + timestamp.
   - If cache hit and not older than 24h, return cached body.
5. fetch(url) — same-origin, no CORS issues.
6. Store in both caches.
7. Return body.
```

Cache is per player hash, not per URL, so different pages on the same session share hits. 24h TTL bounds stale-cache exposure if YouTube changes the algorithm without rotating the hash (unusual but possible).

### 6.4 `signature.ts` — decoder extraction

YouTube's `streamingData.{formats,adaptiveFormats}` entries come in two shapes:

1. **`url` directly** (legacy / some low-quality formats): The URL is mostly usable, but the `n` query parameter must be transformed by a function embedded in `base.js`, or YouTube throttles the download to < 50 KB/s.
2. **`signatureCipher` string** (most modern / HD formats): A URL-encoded blob containing `s` (encrypted signature), `sp` (target param name, usually `sig`), and `url` fields. The `s` value must be transformed by another `base.js` function, and the result appended to `url` as `?<sp>=<transformed>`. The resulting URL *also* has an `n` param that must be transformed by the n-decoder.

#### Extraction strategy

Two sibling extractors operating on `base.js` source text:

**Signature decoder (`s` param):**
- Find the invocation site — one of several known patterns. We try regexes in order:
  ```
  /&&\([a-zA-Z_$][\w$]*?=([a-zA-Z_$][\w$]*?)\([a-zA-Z_$][\w$]*?\)/
  /\b([a-zA-Z_$][\w$]*?)\([a-zA-Z_$][\w$]*?\)\s*;\s*[a-zA-Z_$][\w$]*?\.set\([^,]+?,\1/
  /\.set\(.+?,\s*([a-zA-Z_$][\w$]*?)\(/
  ```
  First match yields the function name.
- Find the function body: `/<name>\s*=\s*function\s*\([^)]*\)\s*\{([^}]+)\}/`.
- Find helper object: the body calls methods like `Xz.xb(a,44); Xz.Ux(a,1)` where `Xz` is a helper object. Regex out the object name and its definition.
- Assemble the decoder source as a self-contained function: `(function(a) { var <helperObj> = {<helperBody>}; <functionBody>; return a; })`.
- Pass this source to `new Function("a", "...")` and cache the resulting function keyed by `baseJs` hash.

**`n` decoder:**
- Function name extraction pattern: `/&&\((b=a\.get\("n"\)\)&&\(b=(\w+)\(b\)/` or a handful of variants.
- Body extraction: `/<name>\s*=\s*function\s*\([^)]*\)\s*\{([\s\S]+?)\};/`.
- Similar to signature decoder, the body references `var [<outer vars>] = ...;` that we include verbatim.
- Wrap in `new Function("n", "...")`.

#### Extractor fallback order

We try three pairs of regexes for each decoder. If all three fail, we emit `signature_extract_failed` / `n_extract_failed`. Users see "YouTube changed their URL format — extension update needed."

When YouTube breaks a regex, a contributor captures the new `base.js` version to `tests/fixtures/youtube/base_js/<hash>.js`, updates the regex set, and all existing fixtures continue passing. Tests guard against regression on the historical versions we've captured.

#### Caching decoded functions

`extractDecoders(baseJsText)` returns:

```ts
interface Decoders {
  signature: (s: string) => string;
  nParam:    (n: string) => string;
}
```

Cached in a module-scoped `Map<baseJsHash, Decoders>`. Cost of extraction: one regex-heavy pass + two `new Function()` calls (~5-10 ms on fresh base.js, < 1 ms on cache hit).

#### Per-format decoding pipeline

```
for each format in streamingData.{formats, adaptiveFormats}:
  if (format.signatureCipher) {
    parse signatureCipher (URLSearchParams)
    s, sp, url = cipher["s"], cipher["sp"], cipher["url"]
    signedSig = decoders.signature(s)
    url += (url.includes("?") ? "&" : "?") + sp + "=" + encodeURIComponent(signedSig)
  } else if (format.url) {
    url = format.url
  } else {
    skip this format
  }

  extract n from url query
  if (n) {
    transformedN = decoders.nParam(n)
    replace n in url with transformedN
  }

  emit format with final url
```

Exceptions during per-format decoding are caught; the individual format is dropped, others continue. If > 50% of formats fail, emit `decode_exception` to the isolated world and show "Couldn't decode formats — try refreshing."

### 6.5 `formats.ts` — pure transformation

Input: `PlayerResponse.streamingData` + `Decoders`.
Output: `OverlayOption[]` grouped into:

- **Combined (audio + video)** — `streamingData.formats`
- **Video only** — `streamingData.adaptiveFormats` where `mimeType` starts with `video/`
- **Audio only** — `streamingData.adaptiveFormats` where `mimeType` starts with `audio/`

Options sorted within group: combined by `qualityLabel` descending, video-only by `height` descending, audio-only by `audioQuality` descending.

Label format:
- Combined / video: `"720p · video/mp4 · 42.3 MB"` (quality + container + size)
- Audio: `"AUDIO_QUALITY_MEDIUM · audio/mp4 · 3.1 MB"` (labeled sanely)

Filename format: `sanitizeFilename(videoDetails.title) + "." + ext` where ext derives from mimeType. Uses the existing `src/capture/sanitize_filename.ts` from the WebSocket hardening work (imported into main-world bundle — pure function, no chrome deps).

Files without `contentLength` get size label elided.

### 6.6 `main_world.ts` — the orchestration seam

The single entry point for the MAIN world. ~80 lines:

- On load: register `yt-navigate-finish` listener, register message listener, send `{ type: "ready" }`.
- On `request-formats`: run the `player_data` → `base_js_loader` → `signature` → `formats` pipeline with try/catch per stage. Emit `formats-ready` or the appropriate `formats-error`.
- On `yt-navigate-finish`: delay 500 ms, re-run the same pipeline, emit `formats-ready`.
- Diagnostics: `console.warn("[WarpDL YT] <step>", errInfo)` on any failure. Low-volume, useful during user bug reports.

---

## 7. Error handling

| Error | Cause | User-visible |
|---|---|---|
| `no_player_response` | Page has no player or player not yet initialized | Overlay text: "No downloadable formats found. Try refreshing." |
| `no_formats` | Player present but `streamingData` missing (rare, age-gated) | Same as above |
| `base_js_fetch_failed` | Network error, 4xx, player hash rotated mid-session | "Couldn't fetch YouTube player code — try refreshing." |
| `signature_extract_failed` | YouTube changed the signature algorithm we recognize | "YouTube changed their URL format — extension update needed." Links to repo. |
| `n_extract_failed` | YouTube changed the n-param algorithm | Same as above, different copy. |
| `decode_exception` | > 50% of formats failed decoding at runtime | "Couldn't decode formats — try refreshing." |
| `unknown` | Fallback | Generic "Something went wrong" |

All errors are caught at module boundaries; no unhandled promise rejections in the main world. Diagnostics go to `console.warn("[WarpDL YT] …")` — deliberately not piped to the service worker's ring buffer (wrong world, would cost another message round-trip for no practical gain).

---

## 8. Testing strategy

### 8.1 Framework

Vitest (established by the WebSocket hardening work). Tests that need DOM use `@vitest-environment jsdom`. Main-world modules that only do string parsing stay in the default Node environment.

### 8.2 Coverage targets

Follow the repo-wide 95 % threshold established in `vitest.config.ts`. New modules include:

| Module | Test count (est.) | Focus |
|---|---|---|
| `overlay.ts` | 14 | Mount, setOptions, toggle, click-outside, fullscreen, resize, compact, destroy |
| `detector.ts` (BaseDetector) | 8 | Scan, mutation handling, stop-cleanup, refresh |
| `detectors/generic.ts` | 8 | Src / source / currentSrc / blob filter / shouldHandle / options shape |
| `detectors/youtube/detector.ts` | 10 | Bridge receive, overlay update, request on mount, SPA refresh, stop-cleanup |
| `detectors/youtube/player_data.ts` | 8 | 3 strategies, malformed JSON, missing script, unicode |
| `detectors/youtube/base_js_loader.ts` | 8 | Cache hit, cache miss, storage hit, storage expired, fetch failure, hash extraction |
| `detectors/youtube/signature.ts` | ~25 | Decoder extraction across captured `base.js` fixtures (~3 archived versions); regex fallback ordering; edge cases |
| `detectors/youtube/formats.ts` | 12 | Grouping, sorting, label format, size elision, sanitize filename |
| `detectors/youtube/main_world.ts` | 10 | Bridge round-trip, error emission, SPA nav, stage failures |

Expected new test count: ~100.

### 8.3 `base.js` fixtures

`tests/fixtures/youtube/base_js/` contains archived `base.js` files keyed by player hash. Each fixture has an accompanying `.expected.json` with:

- Expected signature-decoder test pairs: `[ { input: "abcdef", output: "fedcba" } ]` (sampled from running the real decoder)
- Expected n-decoder test pairs
- A sample encrypted URL and its decrypted form

When YouTube updates base.js and a regex breaks, a contributor runs a small capture script (not shipped — one-liner in README) to save the new fixture + expected outputs. The extractor is updated; the historical fixtures continue passing; the new fixture becomes a regression test.

### 8.4 Integration smoke

A jsdom-backed integration test mounts `content_main.ts` with a simulated YouTube page (static HTML fixture), simulates the main-world postMessage responses, and asserts that:

- Overlay mounts on `#movie_player`
- Click on option dispatches `chrome.runtime.sendMessage` with `{ type: "DOWNLOAD_VIDEO", url, fileName, pageUrl }`
- SPA-nav postMessage updates options without remount
- Error path shows the correct copy

### 8.5 Manual smoke (user)

1. Generic `<video>` page (e.g. a random MP4 on Wikipedia): overlay appears top-right, click downloads to WarpDL.
2. YouTube video with signatureCipher (any post-2020 video): overlay appears, dropdown lists 360p through 1080p+, each option downloads successfully.
3. YouTube SPA navigation (click a video, then click a suggested video): overlay updates without flicker.
4. YouTube fullscreen: overlay is visible in fullscreen.
5. Small embedded video: overlay uses compact mode.
6. Page with `blob:` video (e.g., an MSE-backed player): overlay does NOT appear (correct — out of scope).
7. Video removed from DOM (SPA nav away): overlay cleans up; no console errors.

---

## 9. Migration path

### 9.1 Ordering

Leaves first (pure + overlay + contract), then generic detector, then YouTube main-world pipeline, then YouTube detector, then the single cut-over that swaps content-script entries. A final cleanup removes old files.

### 9.2 Commit sequence (11 commits)

| # | Commit | Ship-safe? |
|---|---|---|
| 1 | Add `src/detect/overlay.ts` + tests | Yes — dead code |
| 2 | Add `src/detect/detector.ts` (`BaseDetector`) + tests | Yes — dead code |
| 3 | Add `src/detect/detectors/generic.ts` + tests | Yes — dead code |
| 4 | Add `src/detect/detectors/youtube/player_data.ts` + tests | Yes — dead code |
| 5 | Add `src/detect/detectors/youtube/base_js_loader.ts` + tests | Yes — dead code |
| 6 | Add `tests/fixtures/youtube/base_js/` archived `base.js` files (3 versions) + expected outputs | Yes — fixtures only |
| 7 | Add `src/detect/detectors/youtube/signature.ts` + tests against fixtures | Yes — dead code |
| 8 | Add `src/detect/detectors/youtube/formats.ts` + tests | Yes — dead code |
| 9 | Add `src/detect/detectors/youtube/main_world.ts` + tests | Yes — dead code |
| 10 | Add `src/detect/detectors/youtube/detector.ts` (isolated) + `src/detect/content_main.ts` + tests | Yes — dead code |
| 11 | **Cut-over:** rewire webpack entries (`content_script.ts`, `youtube_content.ts`, `youtube_main_world.ts`) to the new modules; delete the old `src/content_script.ts`, `src/youtube_content.ts`, `src/youtube_main_world.ts`; manual smoke | Breaking |

Each commit ships with its tests and must pass the 95 % coverage gate before merging.

### 9.3 Rollback

If commit 11 regresses: `git revert` restores the old entry files. Commits 1–10 are unused in the bundle (webpack tree-shakes) — no harm in staying.

### 9.4 Dependency changes

None. No new `devDependencies` or runtime dependencies.

### 9.5 Build system

- `webpack/webpack.config.js`: entry points change `entry` filenames from `src/content_script.ts` → `src/detect/content_main.ts` (or keep same and just restructure). Recommended: change entry paths so the new layout is self-evident.
- `tsconfig.json`: no change.
- `manifest.json`: no change.

### 9.6 File delta

```
add  src/detect/                                       (~10 files + tests)
add  tests/fixtures/youtube/base_js/                   (3 archived base.js files + .expected.json each)
mod  webpack/webpack.config.js                         (entry paths)
del  src/content_script.ts
del  src/youtube_content.ts
del  src/youtube_main_world.ts
keep public/manifest.json
keep src/service_worker.ts, popup.ts, settings.ts, types.ts (+)
keep all src/core/, src/daemon/, src/capture/, src/downloads/, src/messaging/ (WebSocket work)
```

---

## 10. Acceptance criteria

- [ ] `npm run test:coverage` ≥ 95 % across lines/branches/functions/statements on new modules.
- [ ] `npm run build` succeeds; `dist/` loads as an unpacked extension with no manifest errors.
- [ ] Overlay appears top-right on every `<video>` with a direct src (non-`blob:`) across at least 5 tested non-YouTube sites.
- [ ] Overlay appears on YouTube `#movie_player` with a populated dropdown including at least one 1080p-or-higher quality on a 1080p video.
- [ ] YouTube downloads at 720p, 1080p, and audio-only all complete successfully through the daemon.
- [ ] YouTube SPA navigation refreshes the dropdown without unmount flicker.
- [ ] Overlay is visible in fullscreen.
- [ ] Running against an archived-and-extracted `base.js` fixture yields the expected decoded URL (signature + n-param).
- [ ] No console errors on normal pages.
- [ ] Service worker WebSocket contract unchanged; no changes to `src/core/`, `src/daemon/`, `src/downloads/`, `src/messaging/`, or `src/capture/`.

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| YouTube changes signature algorithm (every few weeks historically) | High | Three fallback regexes per decoder, fixture test for every past algorithm, clear user-facing message prompting update when extraction fails |
| `new Function` in main world trips a site's CSP | Low on YouTube (CSP is permissive); N/A elsewhere (generic detector doesn't need eval) | Catch the error; emit `decode_exception`; fall back to only formats with direct `url` fields (throttled but usable) |
| base.js cache goes stale after player hash rotation | Medium | 24 h TTL on chrome.storage cache; on decode failure, invalidate and refetch |
| Overlay conflicts with site-provided fullscreen controls | Low | z-index max; fullscreen re-parent; if click-hijack observed, user can disable via popup's Intercept toggle |
| Heavy pages (many `<video>` elements) mount many overlays and slow DOM | Low | `shouldHandle` filters to videos with a resolvable src; MutationObserver scoped to `body`; max handles effectively bounded by actual video count |
| Fixture `base.js` files are large (~300 KB each) | Known | Three fixtures ≈ 1 MB in repo. Acceptable. Alternative: store gzipped and inflate in setup — YAGNI for now |
| Message-passing race between main and isolated | Low | Initial-state handshake: main sends `ready` first; isolated sends `request-formats` only after receiving `ready` |

---

## 12. Open questions

None — all clarifying questions were resolved during brainstorming. If new questions surface during implementation, they are raised in the PR, not resolved silently.
