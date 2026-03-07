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
