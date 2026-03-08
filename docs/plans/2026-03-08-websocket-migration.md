# WebSocket Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace HTTP POST JSON-RPC 2.0 + Bearer auth with the daemon's existing unauthenticated raw WebSocket endpoint at `ws://host:port/`.

**Architecture:** The service worker maintains a persistent WebSocket to the daemon's root `/` endpoint. Downloads are sent as raw JSON `{url, headers, cookies}` messages. No JSON-RPC, no auth. Content scripts and popup communicate with the service worker via `chrome.runtime.sendMessage`; the service worker forwards download data over the socket.

**Tech Stack:** TypeScript, Webpack, Chrome Extension Manifest V3, WebSocket API

---

### Task 1: Delete `src/jsonrpc.ts`

**Files:**
- Delete: `src/jsonrpc.ts`

**Step 1: Delete the file**

```bash
rm src/jsonrpc.ts
```

**Step 2: Verify no other files import it (besides service_worker.ts which we'll fix later)**

```bash
grep -r "jsonrpc" src/ --include="*.ts"
```

Expected: only `src/service_worker.ts` line 1 references it.

**Step 3: Commit**

```bash
git add -u src/jsonrpc.ts
git commit -m "remove JSON-RPC client module (switching to raw WebSocket)"
```

---

### Task 2: Rewrite `src/types.ts`

Remove all JSON-RPC types, `DownloadAddParams/Result`, `SystemVersionResult`. Fix header casing to `key`/`value` (matching `warplib.Header` json tags). Add `DaemonCookie` matching Go's `http.Cookie` struct. Simplify `ExtensionMessage` (remove `PING`/`GET_STATUS`, add `GET_CONNECTION_STATUS`). Remove `authToken` from settings.

**Files:**
- Modify: `src/types.ts`

**Step 1: Replace entire file**

```typescript
// ── Daemon types (matches Go structs in warpdl) ──

// Matches warplib.Header: json tags are lowercase "key" / "value"
export interface DaemonHeader {
  key: string;
  value: string;
}

// Matches Go's net/http.Cookie struct (field names are PascalCase, no json tags)
export interface DaemonCookie {
  Name: string;
  Value: string;
  Path?: string;
  Domain?: string;
  Expires?: string;
  MaxAge?: number;
  Secure?: boolean;
  HttpOnly?: boolean;
  SameSite?: number; // Go's http.SameSite is an int: 0=default, 1=lax, 2=strict, 3=none
}

// The message format the daemon's root WebSocket expects (capturedDownload struct)
export interface CapturedDownload {
  url: string;
  headers: DaemonHeader[];
  cookies: DaemonCookie[];
}

// ── Extension settings ──

export interface ExtensionSettings {
  daemonUrl: string; // e.g. "localhost:3850"
  interceptDownloads: boolean;
}

// ── Internal messaging (content script / popup <-> service worker) ──

export type ExtensionMessage =
  | { type: "DOWNLOAD_VIDEO"; url: string; fileName?: string; pageUrl?: string }
  | { type: "GET_CONNECTION_STATUS" };

export interface ConnectionStatusResponse {
  connected: boolean;
}

// ── YouTube types ──

export interface YouTubeFormat {
  url?: string;
  signatureCipher?: string;
  mimeType: string;
  qualityLabel?: string;
  bitrate?: number;
  contentLength?: string;
  width?: number;
  height?: number;
  audioQuality?: string;
}

export interface YouTubeStreamingData {
  formats?: YouTubeFormat[];
  adaptiveFormats?: YouTubeFormat[];
}

export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  lengthSeconds: string;
  author: string;
}

export interface YouTubePlayerResponse {
  videoDetails?: YouTubeVideoDetails;
  streamingData?: YouTubeStreamingData;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "rewrite types for raw WebSocket protocol (remove JSON-RPC, fix header casing)"
```

---

### Task 3: Rewrite `src/settings.ts`

Remove `authToken` from defaults. Change `daemonUrl` default to `localhost:3850` (no scheme — the service worker will prepend `ws://`).

**Files:**
- Modify: `src/settings.ts`

**Step 1: Replace entire file**

```typescript
import { ExtensionSettings } from "./types";

const DEFAULTS: ExtensionSettings = {
  daemonUrl: "localhost:3850",
  interceptDownloads: true,
};

const STORAGE_KEY = "settings";

export async function loadSettings(): Promise<ExtensionSettings> {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  return { ...DEFAULTS, ...(data[STORAGE_KEY] ?? {}) };
}

export async function saveSettings(
  settings: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.sync.set({ [STORAGE_KEY]: merged });
  return merged;
}

export function onSettingsChanged(
  cb: (settings: ExtensionSettings) => void
): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      const newVal = changes[STORAGE_KEY].newValue as ExtensionSettings;
      cb({ ...DEFAULTS, ...newVal });
    }
  });
}
```

**Step 2: Commit**

```bash
git add src/settings.ts
git commit -m "remove authToken from settings, use plain host:port for daemon URL"
```

---

### Task 4: Rewrite `src/service_worker.ts`

Replace `JsonRpcClient` with a `DaemonSocket` class that connects via WebSocket to `ws://<daemonUrl>/`. Auto-reconnect with exponential backoff. Send `CapturedDownload` messages. Convert chrome cookies to `DaemonCookie` objects. Header casing is now lowercase `key`/`value`.

**Files:**
- Modify: `src/service_worker.ts`

**Step 1: Replace entire file**

```typescript
import { loadSettings, onSettingsChanged } from "./settings";
import {
  CapturedDownload,
  ConnectionStatusResponse,
  DaemonCookie,
  DaemonHeader,
  ExtensionMessage,
  ExtensionSettings,
} from "./types";

// ── WebSocket client ──

class DaemonSocket {
  private socket: WebSocket | null = null;
  private url: string;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.intentionallyClosed = false;
    this.cleanup();

    try {
      this.socket = new WebSocket(`ws://${this.url}`);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      console.log("[WarpDL] Connected to daemon");
      this.reconnectDelay = 1000;
    };

    this.socket.onclose = () => {
      console.log("[WarpDL] Disconnected from daemon");
      this.socket = null;
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = () => {
      // onclose will fire after this, which handles reconnect
    };
  }

  updateUrl(url: string): void {
    if (this.url === url) return;
    this.url = url;
    this.reconnect();
  }

  reconnect(): void {
    this.disconnect();
    this.reconnectDelay = 1000;
    this.connect();
  }

  send(data: CapturedDownload): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error("[WarpDL] Cannot send: not connected");
      return false;
    }
    this.socket.send(JSON.stringify(data));
    return true;
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }
}

// ── State ──

let settings: ExtensionSettings;
let daemon: DaemonSocket;
const headerStore = new Map<
  string,
  chrome.webRequest.HttpHeader[] | undefined
>();
const MAX_HEADER_STORE = 1000;

// ── Initialization ──

async function init(): Promise<void> {
  settings = await loadSettings();
  daemon = new DaemonSocket(settings.daemonUrl);
  daemon.connect();

  onSettingsChanged((newSettings) => {
    settings = newSettings;
    daemon.updateUrl(settings.daemonUrl);
  });
}

init();

// ── First install ──

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const data = await chrome.storage.local.get("installed");
    if (data.installed != null) return;
    await chrome.storage.local.set({ installed: true });
    await chrome.tabs.create({ url: "thanks.html" });
  }
});

// ── Header capture ──

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (headerStore.size > MAX_HEADER_STORE) {
      const firstKey = headerStore.keys().next().value;
      if (firstKey) headerStore.delete(firstKey);
    }
    headerStore.set(details.url, details.requestHeaders);
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const data = headerStore.get(details.url);
    headerStore.delete(details.url);
    if (details.redirectUrl) {
      headerStore.set(details.redirectUrl, data);
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    headerStore.delete(details.url);
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    headerStore.delete(details.url);
  },
  { urls: ["<all_urls>"] }
);

// ── Cookie conversion ──

function toDaemonCookie(c: chrome.cookies.Cookie): DaemonCookie {
  const cookie: DaemonCookie = {
    Name: c.name,
    Value: c.value,
    Domain: c.domain,
    Path: c.path,
    HttpOnly: c.httpOnly,
    Secure: c.secure,
  };
  if (c.expirationDate) {
    cookie.Expires = new Date(c.expirationDate * 1000).toUTCString();
  }
  // Map chrome SameSite to Go's http.SameSite int
  if (c.sameSite === "lax") cookie.SameSite = 1;
  else if (c.sameSite === "strict") cookie.SameSite = 2;
  else if (c.sameSite === "no_restriction") cookie.SameSite = 3;
  return cookie;
}

// ── Download interception ──

chrome.downloads.onCreated.addListener(
  async (downloadItem: chrome.downloads.DownloadItem) => {
    if (!settings.interceptDownloads) return;

    const url = downloadItem.finalUrl || downloadItem.url;

    chrome.downloads.cancel(downloadItem.id, () => {
      chrome.downloads.erase({ id: downloadItem.id });
    });

    const headers: DaemonHeader[] = [];
    const storedHeaders = headerStore.get(url);
    if (storedHeaders) {
      for (const h of storedHeaders) {
        if (h.value) {
          headers.push({ key: h.name, value: h.value });
        }
      }
    }

    let cookies: DaemonCookie[] = [];
    try {
      const chromeCookies = await chrome.cookies.getAll({ url });
      cookies = chromeCookies.map(toDaemonCookie);
    } catch {
      // cookie access may fail for some URLs
    }

    const msg: CapturedDownload = { url, headers, cookies };
    daemon.send(msg);
    headerStore.delete(url);
  }
);

// ── Message handler (content scripts / popup) ──

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    handleMessage(message, sender).then(sendResponse).catch((err) => {
      console.error("[WarpDL] message handler error:", err);
      sendResponse({ error: String(err) });
    });
    return true;
  }
);

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "GET_CONNECTION_STATUS": {
      return { connected: daemon.isConnected() } as ConnectionStatusResponse;
    }

    case "DOWNLOAD_VIDEO": {
      const headers: DaemonHeader[] = [];

      const pageUrl = message.pageUrl || sender.tab?.url;
      if (pageUrl) {
        headers.push({ key: "Referer", value: pageUrl });
      }

      let cookies: DaemonCookie[] = [];
      try {
        const chromeCookies = await chrome.cookies.getAll({
          url: message.url,
        });
        cookies = chromeCookies.map(toDaemonCookie);
      } catch {
        // ignore
      }

      const msg: CapturedDownload = {
        url: message.url,
        headers,
        cookies,
      };
      const sent = daemon.send(msg);
      return { success: sent };
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/service_worker.ts
git commit -m "rewrite service worker to use raw WebSocket with auto-reconnect"
```

---

### Task 5: Rewrite `public/popup.html`

Remove the auth token field. Simplify to just: daemon URL, intercept toggle, save button. Status dot reflects WebSocket state.

**Files:**
- Modify: `public/popup.html`

**Step 1: Replace entire file**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 16px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #2a2a4a;
    }
    .header h1 {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ff4444;
      flex-shrink: 0;
    }
    .status-dot.connected { background: #44ff44; }
    .status-text {
      font-size: 11px;
      color: #999;
      margin-left: auto;
    }
    .field {
      margin-bottom: 12px;
    }
    .field label {
      display: block;
      font-size: 11px;
      color: #aaa;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .field input {
      width: 100%;
      padding: 8px 10px;
      background: #16213e;
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 13px;
      outline: none;
    }
    .field input:focus {
      border-color: #5a5aff;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding: 8px 0;
    }
    .toggle-row label {
      font-size: 13px;
    }
    .toggle {
      position: relative;
      width: 40px;
      height: 22px;
    }
    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #333;
      border-radius: 22px;
      transition: 0.2s;
    }
    .toggle .slider::before {
      content: "";
      position: absolute;
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background: #fff;
      border-radius: 50%;
      transition: 0.2s;
    }
    .toggle input:checked + .slider { background: #5a5aff; }
    .toggle input:checked + .slider::before { transform: translateX(18px); }
    button {
      width: 100%;
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      transition: opacity 0.15s;
      background: #5a5aff;
      color: #fff;
    }
    button:hover { opacity: 0.85; }
    .feedback {
      text-align: center;
      font-size: 11px;
      margin-top: 8px;
      min-height: 16px;
      color: #44ff44;
    }
    .feedback.error { color: #ff4444; }
  </style>
</head>
<body>
  <div class="header">
    <h1>WarpDL</h1>
    <div id="status-dot" class="status-dot"></div>
    <span id="status-text" class="status-text">Disconnected</span>
  </div>

  <div class="field">
    <label>Daemon Address</label>
    <input type="text" id="daemon-url" placeholder="localhost:3850">
  </div>

  <div class="toggle-row">
    <label>Intercept Downloads</label>
    <div class="toggle">
      <input type="checkbox" id="intercept-toggle" checked>
      <span class="slider"></span>
    </div>
  </div>

  <button id="btn-save">Save</button>

  <div id="feedback" class="feedback"></div>

  <script src="popup.js"></script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add public/popup.html
git commit -m "simplify popup: remove auth token field"
```

---

### Task 6: Rewrite `src/popup.ts`

Remove auth token references. Status check uses `GET_CONNECTION_STATUS` message. Remove test connection button logic. Save triggers reconnect via settings change.

**Files:**
- Modify: `src/popup.ts`

**Step 1: Replace entire file**

```typescript
import { loadSettings, saveSettings } from "./settings";
import { ConnectionStatusResponse, ExtensionMessage } from "./types";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const statusDot = $<HTMLDivElement>("status-dot");
const statusText = $<HTMLSpanElement>("status-text");
const daemonUrlInput = $<HTMLInputElement>("daemon-url");
const interceptToggle = $<HTMLInputElement>("intercept-toggle");
const btnSave = $<HTMLButtonElement>("btn-save");
const feedback = $<HTMLDivElement>("feedback");

function showFeedback(msg: string, isError = false): void {
  feedback.textContent = msg;
  feedback.className = isError ? "feedback error" : "feedback";
  setTimeout(() => {
    feedback.textContent = "";
  }, 3000);
}

function setStatus(connected: boolean): void {
  if (connected) {
    statusDot.classList.add("connected");
    statusText.textContent = "Connected";
  } else {
    statusDot.classList.remove("connected");
    statusText.textContent = "Disconnected";
  }
}

async function checkStatus(): Promise<void> {
  try {
    const msg: ExtensionMessage = { type: "GET_CONNECTION_STATUS" };
    const resp = (await chrome.runtime.sendMessage(
      msg
    )) as ConnectionStatusResponse;
    setStatus(resp.connected);
  } catch {
    setStatus(false);
  }
}

async function populateFields(): Promise<void> {
  const s = await loadSettings();
  daemonUrlInput.value = s.daemonUrl;
  interceptToggle.checked = s.interceptDownloads;
}

btnSave.addEventListener("click", async () => {
  await saveSettings({
    daemonUrl: daemonUrlInput.value.trim(),
    interceptDownloads: interceptToggle.checked,
  });
  showFeedback("Settings saved");
  // Recheck after a moment (service worker reconnects on settings change)
  setTimeout(checkStatus, 1500);
});

populateFields();
checkStatus();
```

**Step 2: Commit**

```bash
git add src/popup.ts
git commit -m "simplify popup logic: WebSocket status, no auth"
```

---

### Task 7: Build and verify

**Step 1: Build**

```bash
npm run build
```

Expected: compiles with 0 errors, produces 5 JS files in `dist/`.

**Step 2: Verify output files**

```bash
ls dist/
```

Expected: `content_script.js`, `manifest.json`, `popup.html`, `popup.js`, `service_worker.js`, `thanks.html`, `youtube_content.js`, `youtube_main_world.js`

**Step 3: Verify jsonrpc.ts is not bundled**

```bash
grep -l "jsonrpc" dist/*.js
```

Expected: no matches.

**Step 4: Verify header casing in service_worker.js**

```bash
grep -c '"key"' dist/service_worker.js
```

Expected: nonzero (lowercase keys used).

**Step 5: Commit**

```bash
git add -A
git commit -m "build: verify clean WebSocket-based build"
```
