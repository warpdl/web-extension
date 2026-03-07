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
