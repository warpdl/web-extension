import { loadSettings, saveSettings } from "./settings";
import { validateDaemonUrl } from "./capture/url_validator";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const title = $<HTMLHeadingElement>("title");
const statusDot = $<HTMLDivElement>("status-dot");
const statusText = $<HTMLSpanElement>("status-text");
const banner = $<HTMLDivElement>("banner");
const bannerText = $<HTMLSpanElement>("banner-text");
const btnRetry = $<HTMLButtonElement>("btn-retry");
const daemonUrlInput = $<HTMLInputElement>("daemon-url");
const urlError = $<HTMLDivElement>("url-error");
const interceptToggle = $<HTMLInputElement>("intercept-toggle");
const btnSave = $<HTMLButtonElement>("btn-save");
const feedback = $<HTMLDivElement>("feedback");
const diag = $<HTMLDivElement>("diag");
const diagLog = $<HTMLPreElement>("diag-log");

let titleClicks = 0;
let titleClickTimer: number | null = null;

title.addEventListener("click", () => {
  titleClicks++;
  if (titleClickTimer !== null) clearTimeout(titleClickTimer);
  titleClickTimer = window.setTimeout(() => { titleClicks = 0; }, 800);
  if (titleClicks >= 3) {
    diag.classList.toggle("visible");
    titleClicks = 0;
    if (diag.classList.contains("visible")) refreshDiagnostics();
  }
});

async function refreshDiagnostics(): Promise<void> {
  try {
    const data = await chrome.storage.local.get("ring_buffer");
    const ring = (data.ring_buffer as unknown[]) || [];
    diagLog.textContent = ring.length === 0
      ? "(empty)"
      : ring.map((e: any) => `[${e.level}] ${e.scope} ${e.msg}`).join("\n");
  } catch {
    diagLog.textContent = "(failed to load)";
  }
}

function setStatus(state: string): void {
  statusDot.className = "status-dot";
  banner.style.display = "none";
  btnRetry.style.display = "none";

  switch (state) {
    case "OPEN":
      statusDot.classList.add("connected");
      statusText.textContent = "Connected";
      break;
    case "CONNECTING":
      statusDot.classList.add("connecting");
      statusText.textContent = "Connecting…";
      break;
    case "RECONNECTING":
      statusDot.classList.add("connecting");
      statusText.textContent = "Reconnecting…";
      break;
    case "DISABLED":
      statusDot.classList.add("disabled");
      statusText.textContent = "Daemon unreachable";
      banner.className = "banner error";
      banner.style.display = "block";
      bannerText.textContent = "Connection disabled after repeated failures.";
      btnRetry.style.display = "inline-block";
      break;
    case "IDLE":
    default:
      statusText.textContent = state;
      break;
  }
}

btnRetry.addEventListener("click", () => {
  port.postMessage({ type: "resume" });
});

async function populateFields(): Promise<void> {
  const s = await loadSettings();
  daemonUrlInput.value = s.daemonUrl;
  interceptToggle.checked = s.interceptDownloads;
}

function showFeedback(msg: string, isError = false): void {
  feedback.textContent = msg;
  feedback.className = isError ? "feedback error" : "feedback";
  setTimeout(() => { feedback.textContent = ""; }, 3000);
}

btnSave.addEventListener("click", async () => {
  const raw = daemonUrlInput.value.trim();
  const validation = validateDaemonUrl(raw);
  if (!validation.ok) {
    urlError.textContent = `Invalid: ${validation.error}`;
    return;
  }
  urlError.textContent = "";
  await saveSettings({
    daemonUrl: `${validation.host}:${validation.port}`,
    interceptDownloads: interceptToggle.checked,
  });
  showFeedback("Settings saved");
});

// Live status via chrome.runtime.Port
const port = chrome.runtime.connect({ name: "popup-status" });
port.onMessage.addListener((msg: { type: string; state?: string }) => {
  if (msg.type === "state" && msg.state) setStatus(msg.state);
});
port.onDisconnect.addListener(() => {
  setStatus("IDLE");
});

populateFields();
