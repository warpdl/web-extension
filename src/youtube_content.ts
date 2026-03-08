// YouTube content script (ISOLATED world) — download button with quality dropdown

import { YouTubeFormat, YouTubePlayerResponse } from "./types";

const CONTENT_SOURCE = "warpdl-youtube-content";
const MAIN_SOURCE = "warpdl-youtube-main";

let playerResponse: YouTubePlayerResponse | null = null;
let dropdown: HTMLDivElement | null = null;

// ── Listen for player data from main world ──

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== MAIN_SOURCE) return;
  if (event.data.type === "PLAYER_DATA") {
    playerResponse = event.data.data as YouTubePlayerResponse | null;
  }
});

// ── SPA navigation handling ──

document.addEventListener("yt-navigate-finish", () => {
  playerResponse = null;
  removeDropdown();
  injectButton();
  // Ask main world to re-extract
  window.postMessage(
    { source: CONTENT_SOURCE, type: "REQUEST_PLAYER_DATA" },
    "*"
  );
});

// ── Button injection ──

const BUTTON_SELECTORS = [
  "#top-level-buttons-computed",
  "ytd-menu-renderer.ytd-watch-metadata #top-level-buttons-computed",
  "#actions ytd-menu-renderer #top-level-buttons-computed",
  "#menu #top-level-buttons-computed",
];

function findActionBar(): Element | null {
  for (const sel of BUTTON_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function injectButton(): void {
  // Remove existing button if any
  document.getElementById("warpdl-yt-btn")?.remove();

  const actionBar = findActionBar();
  if (!actionBar) {
    // Retry — YouTube may not have rendered yet
    setTimeout(injectButton, 1000);
    return;
  }

  const btn = document.createElement("button");
  btn.id = "warpdl-yt-btn";
  btn.textContent = "\u2B07 WarpDL";
  Object.assign(btn.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "0 16px",
    height: "36px",
    background: "#5a5aff",
    color: "#fff",
    border: "none",
    borderRadius: "18px",
    fontSize: "14px",
    fontWeight: "500",
    fontFamily: "Roboto, Arial, sans-serif",
    cursor: "pointer",
    marginLeft: "8px",
    verticalAlign: "middle",
    lineHeight: "36px",
    whiteSpace: "nowrap",
  } as CSSStyleDeclaration);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown(btn);
  });

  actionBar.appendChild(btn);
}

// ── Dropdown ──

function formatFileSize(bytes: string | undefined): string {
  if (!bytes) return "";
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return "";
  if (n > 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n > 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function formatLabel(f: YouTubeFormat): string {
  const parts: string[] = [];
  if (f.qualityLabel) parts.push(f.qualityLabel);
  else if (f.audioQuality) parts.push(f.audioQuality);

  // Extract codec from mimeType e.g. video/mp4; codecs="avc1.64001F"
  const mimeShort = f.mimeType.split(";")[0];
  parts.push(mimeShort);

  const size = formatFileSize(f.contentLength);
  if (size) parts.push(size);

  return parts.join(" \u2022 ");
}

function createFormatItem(
  f: YouTubeFormat,
  title: string
): HTMLDivElement {
  const item = document.createElement("div");
  item.textContent = formatLabel(f);
  Object.assign(item.style, {
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "13px",
    color: "#e0e0e0",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as CSSStyleDeclaration);

  item.addEventListener("mouseenter", () => {
    item.style.background = "#3a3a5a";
  });
  item.addEventListener("mouseleave", () => {
    item.style.background = "transparent";
  });

  item.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!f.url) return;

    // Sanitize file name
    const sanitized = title.replace(/[<>:"/\\|?*]+/g, "_").substring(0, 200);
    const ext = f.mimeType.split(";")[0].split("/")[1] || "mp4";
    const fileName = `${sanitized}.${ext}`;

    chrome.runtime.sendMessage({
      type: "DOWNLOAD_VIDEO",
      url: f.url,
      fileName,
      pageUrl: window.location.href,
    });

    item.textContent = "\u2713 Sent!";
    setTimeout(removeDropdown, 1000);
  });

  return item;
}

function createSectionHeader(text: string): HTMLDivElement {
  const header = document.createElement("div");
  header.textContent = text;
  Object.assign(header.style, {
    padding: "8px 14px 4px",
    fontSize: "11px",
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  } as CSSStyleDeclaration);
  return header;
}

function toggleDropdown(anchor: HTMLElement): void {
  if (dropdown) {
    removeDropdown();
    return;
  }

  if (!playerResponse?.streamingData) {
    showNoData(anchor);
    return;
  }

  const sd = playerResponse.streamingData;
  const title = playerResponse.videoDetails?.title || "video";

  dropdown = document.createElement("div");
  Object.assign(dropdown.style, {
    position: "fixed",
    background: "#1a1a2e",
    border: "1px solid #2a2a4a",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    zIndex: "2147483647",
    maxHeight: "400px",
    overflowY: "auto",
    minWidth: "280px",
  } as CSSStyleDeclaration);

  // Combined formats
  const combined = (sd.formats || []).filter((f) => f.url);
  if (combined.length > 0) {
    dropdown.appendChild(createSectionHeader("Combined (Audio + Video)"));
    combined.forEach((f) => dropdown!.appendChild(createFormatItem(f, title)));
  }

  // Video only
  const videoOnly = (sd.adaptiveFormats || []).filter(
    (f) => f.url && f.mimeType.startsWith("video/")
  );
  if (videoOnly.length > 0) {
    dropdown.appendChild(createSectionHeader("Video Only"));
    videoOnly.forEach((f) => dropdown!.appendChild(createFormatItem(f, title)));
  }

  // Audio only
  const audioOnly = (sd.adaptiveFormats || []).filter(
    (f) => f.url && f.mimeType.startsWith("audio/")
  );
  if (audioOnly.length > 0) {
    dropdown.appendChild(createSectionHeader("Audio Only"));
    audioOnly.forEach((f) => dropdown!.appendChild(createFormatItem(f, title)));
  }

  if (combined.length === 0 && videoOnly.length === 0 && audioOnly.length === 0) {
    showNoData(anchor);
    return;
  }

  // Position below the button
  document.body.appendChild(dropdown);
  const rect = anchor.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${rect.left}px`;

  // Click outside to close
  setTimeout(() => {
    document.addEventListener("click", onClickOutside);
  }, 0);
}

function showNoData(anchor: HTMLElement): void {
  dropdown = document.createElement("div");
  Object.assign(dropdown.style, {
    position: "fixed",
    background: "#1a1a2e",
    border: "1px solid #2a2a4a",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    zIndex: "2147483647",
    padding: "16px",
    color: "#999",
    fontSize: "13px",
    minWidth: "200px",
  } as CSSStyleDeclaration);
  dropdown.textContent = "No downloadable formats found. Try refreshing the page.";

  document.body.appendChild(dropdown);
  const rect = anchor.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${rect.left}px`;

  setTimeout(() => {
    document.addEventListener("click", onClickOutside);
  }, 0);
}

function onClickOutside(e: MouseEvent): void {
  if (dropdown && !dropdown.contains(e.target as Node)) {
    removeDropdown();
  }
}

function removeDropdown(): void {
  if (dropdown) {
    dropdown.remove();
    dropdown = null;
  }
  document.removeEventListener("click", onClickOutside);
}

// ── Initial injection ──

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(injectButton, 1500);
  });
} else {
  setTimeout(injectButton, 1500);
}
