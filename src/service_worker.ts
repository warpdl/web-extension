import { Container } from "./core/container";

const container = new Container();

const ready = container.start().catch((err) => {
  console.error("[WarpDL] container start failed:", err);
  throw err;
});

// ── First-install thanks page ──

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const data = await chrome.storage.local.get("installed");
    if (data.installed != null) return;
    await chrome.storage.local.set({ installed: true });
    await chrome.tabs.create({ url: "thanks.html" });
  }
});

// ── webRequest header capture ──

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    ready.then(() => {
      if (!details.requestHeaders) return;
      container.headerStore.set(
        details.url,
        details.requestHeaders as unknown as { name: string; value: string | undefined }[],
      );
    }).catch(() => {});
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    ready.then(() => {
      if (details.redirectUrl) container.headerStore.migrate(details.url, details.redirectUrl);
    }).catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    ready.then(() => container.headerStore.delete(details.url)).catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    ready.then(() => container.headerStore.delete(details.url)).catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

// ── Download interception ──

chrome.downloads.onCreated.addListener((item) => {
  ready.then(() => container.interceptor.handle(item as { id: number; url: string; finalUrl?: string })).catch(() => {});
});

// ── Message handling ──

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ready.then(() => container.router.handle(message as any)).then(sendResponse).catch((err) => {
    sendResponse({ error: String(err) });
  });
  return true;   // async response
});

// ── Safety nets ──

(self as any).addEventListener("unhandledrejection", (e: any) => {
  console.error("[WarpDL] unhandledrejection:", e.reason);
  e.preventDefault();
});
(self as any).addEventListener("error", (e: any) => {
  console.error("[WarpDL] uncaught error:", e.message, "at", e.filename, ":", e.lineno);
});
