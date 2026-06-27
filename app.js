/* =========================================================================
   app.js — wiring. Keeps state and DOM glue in one place; the real work
   lives in camera.js / vision.js / speech.js (one concern each).
   ========================================================================= */

import { startCamera, captureFrame, bindVisibility, isSecure,
         setFilter, setZoom, resetEnhance } from "./camera.js";
import { analyzeImage, exaEnrich, TASKS, taskTitle } from "./vision.js";
import { speak, stopSpeaking, vibrate, voiceInputSupported,
         createRecognizer } from "./speech.js";

// ---- In-memory session keys (never persisted) ---------------------------
const keys = { openai: "", exa: "" };

// ---- Element handles -----------------------------------------------------
const $ = (id) => document.getElementById(id);
const video    = $("camera");
const startBtn = $("startBtn");
const statusEl = $("status");
const actions  = $("actions");

const resultOverlay = $("resultOverlay");
const resultTitle   = $("resultTitle");
const resultText    = $("resultText");
const resultExtra   = $("resultExtra");
const thinking      = $("thinking");
const thinkingText  = $("thinkingText");
const replayBtn     = $("replayBtn");
const resultClose   = $("resultClose");

const askOverlay = $("askOverlay");
const micBtn     = $("micBtn");
const micLabel   = $("micLabel");
const askHeard   = $("askHeard");
const askInput   = $("askInput");
const askSend    = $("askSend");
const askCancel  = $("askCancel");

const settingsOverlay = $("settingsOverlay");
const openaiKey   = $("openaiKey");
const exaKey      = $("exaKey");
const settingsSave   = $("settingsSave");
const settingsCancel = $("settingsCancel");

const enhancePanel = $("enhancePanel");
const zoom         = $("zoom");
const zoomValue    = $("zoomValue");
const enhanceReset = $("enhanceReset");
const enhanceClose = $("enhanceClose");

let welcomed = false;
let lastResultText = "";
let lastFocused = null;
let currentAbort = null;

// ---- Status caption (large print + spoken) ------------------------------
function setStatus(text, tone) {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (tone ? " status--" + tone : "");
  if (tone === "error") { vibrate([120, 60, 120]); speak(text); }
  else if (tone === "ok") { vibrate(40); speak(text); }
}

// ---- Overlay helpers (focus management for screen readers) --------------
function openOverlay(overlay, focusEl) {
  lastFocused = document.activeElement;
  overlay.hidden = false;
  (focusEl || overlay.querySelector("button, textarea, input"))?.focus();
}
function closeOverlay(overlay) {
  overlay.hidden = true;
  if (lastFocused) { try { lastFocused.focus(); } catch (_) {} }
}

// ---- Camera start --------------------------------------------------------
async function start() {
  if (!isSecure()) {
    setStatus("Camera needs a secure HTTPS connection. Open this page over https.", "error");
    return;
  }
  startBtn.disabled = true;
  setStatus("Starting camera…", "active");
  try {
    await startCamera(video);
    startBtn.hidden = true;
    actions.hidden = false;
    setStatus("Camera ready. Choose an action, or point and tap Describe.", "ok");
    setTimeout(() => { if (statusEl.textContent.startsWith("Camera ready")) setStatus(""); }, 4000);
    // Send a screen-reader/self-voicing user straight to the main action.
    actions.querySelector(".action--primary")?.focus();
  } catch (err) {
    startBtn.disabled = false;
    reportCameraError(err);
  }
}

function reportCameraError(err) {
  const name = err && err.name ? err.name : "";
  let msg;
  switch (name) {
    case "InsecureContextError":
      msg = "Camera needs a secure HTTPS connection."; break;
    case "NotAllowedError": case "SecurityError":
      msg = "Camera permission was blocked. Allow camera access in your browser settings, then tap Start camera again."; break;
    case "NotFoundError": case "OverconstrainedError":
      msg = "No usable camera was found on this device."; break;
    case "NotReadableError":
      msg = "The camera is busy in another app. Close it and tap Start camera again."; break;
    default:
      msg = "Could not start the camera. Tap Start camera to try again.";
  }
  setStatus(msg, "error");
}

// ---- The capture → model → speak loop -----------------------------------
async function runTask(task, question) {
  if (!keys.openai) { needKey(); return; }
  const cfg = TASKS[task] || TASKS.describe;

  // Open result sheet in "thinking" mode and announce the chosen action so a
  // blind user immediately hears that the right thing is happening.
  resultExtra.hidden = true;
  resultExtra.textContent = "";
  resultText.textContent = "";
  resultTitle.textContent = taskTitle(task);
  thinkingText.textContent = "Looking…";
  thinking.hidden = false;
  replayBtn.disabled = true;
  openOverlay(resultOverlay, resultClose);
  vibrate(30);
  speak(cfg.title + "…");

  let imageDataUrl;
  try {
    imageDataUrl = captureFrame(video, cfg.maxDim);
  } catch (_) {
    return showResultError("Couldn't capture a frame from the camera. Try again.");
  }

  currentAbort = new AbortController();
  try {
    const text = await analyzeImage({
      task, question, imageDataUrl, apiKey: keys.openai, signal: currentAbort.signal,
    });
    showResult(text);
    if (task === "medicine" && keys.exa) enrich(text);
  } catch (err) {
    showResultError(err.message || "Something went wrong. Try again.");
  } finally {
    currentAbort = null;
  }
}

function showResult(text) {
  thinking.hidden = true;
  lastResultText = text;
  resultText.textContent = text;
  replayBtn.disabled = false;
  speak(text);
}

function showResultError(message) {
  thinking.hidden = true;
  resultText.textContent = message;
  resultTitle.textContent = "Sorry";
  lastResultText = message;
  replayBtn.disabled = false;
  vibrate([120, 60, 120]);
  speak(message);
}

// Non-blocking Exa enrichment — never breaks/blocks the core label read.
async function enrich(labelText) {
  try {
    const extra = await exaEnrich({ labelText, apiKey: keys.exa });
    if (!extra) return;
    resultExtra.hidden = false;
    resultExtra.textContent = "More info: " + extra;
    speak(extra, { interrupt: false }); // queue after the label read
  } catch (_) { /* enrichment is best-effort */ }
}

function needKey() {
  setStatus("Add your OpenAI key in Settings to use this.", "error");
  openSettings();
}

// ---- Ask dialog (voice + typed fallback) --------------------------------
let recognizer = null;
let listening = false;

function openAsk() {
  askHeard.textContent = "";
  askInput.value = "";
  if (!voiceInputSupported) {
    micBtn.disabled = true;
    micLabel.textContent = "Voice not supported — type below";
  }
  openOverlay(askOverlay, voiceInputSupported ? micBtn : askInput);
}

function setListening(on) {
  listening = on;
  micBtn.classList.toggle("is-listening", on);
  micLabel.textContent = on ? "Listening… tap to stop" : "Tap to speak";
  if (on) vibrate(40);
}

function toggleMic() {
  if (!voiceInputSupported) return;
  if (listening) { recognizer?.stop(); return; }

  recognizer = createRecognizer({
    onInterim: (t) => { askHeard.textContent = t; askInput.value = t; },
    onFinal:   (t) => { askHeard.textContent = t; askInput.value = t; },
    onError:   (m) => { setListening(false); askHeard.textContent = m; speak(m); },
    onEnd:     () => setListening(false),
  });
  if (!recognizer) return;
  setListening(true);
  recognizer.start();
}

function sendAsk() {
  if (listening) recognizer?.stop();
  const q = askInput.value.trim();
  if (!q) { speak("Please say or type a question first."); askInput.focus(); return; }
  closeOverlay(askOverlay);
  runTask("ask", q);
}

// ---- Settings ------------------------------------------------------------
function openSettings() {
  openaiKey.value = keys.openai;
  exaKey.value = keys.exa;
  openOverlay(settingsOverlay, openaiKey);
}
function saveSettings() {
  keys.openai = openaiKey.value.trim();
  keys.exa = exaKey.value.trim();
  closeOverlay(settingsOverlay);
  setStatus(keys.openai ? "Settings saved." : "Saved, but no OpenAI key set yet.", "ok");
}

// ---- Enhance (no network) ------------------------------------------------
function openEnhance() {
  openOverlay(enhancePanel, enhanceClose);
}
function onZoom() {
  const z = parseFloat(zoom.value);
  setZoom(video, z);
  zoomValue.textContent = z.toFixed(1) + "×";
}
function onFilterToggle(btn) {
  const name = btn.dataset.filter;
  const on = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", String(on));
  setFilter(video, name, on);
  speak((on ? "On: " : "Off: ") + btn.textContent.trim());
}
function resetEnhancements() {
  resetEnhance(video);
  zoom.value = 1; zoomValue.textContent = "1.0×";
  enhancePanel.querySelectorAll(".toggle").forEach((t) => t.setAttribute("aria-pressed", "false"));
  speak("Enhancements reset.");
}

// ---- Welcome / onboarding (blind-first) ---------------------------------
const WELCOME =
  "Welcome to Second Sight, a spare pair of eyes. " +
  "Tap anywhere on the screen to start your camera.";

function welcome() { if (!welcomed) { welcomed = true; speak(WELCOME); } }

function onReady() {
  try { startBtn.focus({ preventScroll: true }); } catch (_) { startBtn.focus(); }
  welcome();
}

// ---- Wire up -------------------------------------------------------------
startBtn.addEventListener("click", start);
window.addEventListener("pointerdown", welcome, { once: true });

// Action bar (event delegation)
actions.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.task) return runTask(btn.dataset.task);
  switch (btn.dataset.open) {
    case "ask":      return openAsk();
    case "enhance":  return openEnhance();
    case "settings": return openSettings();
  }
});

// Result dialog
replayBtn.addEventListener("click", () => speak(lastResultText));
resultClose.addEventListener("click", () => { currentAbort?.abort(); stopSpeaking(); closeOverlay(resultOverlay); });

// Ask dialog
micBtn.addEventListener("click", toggleMic);
askSend.addEventListener("click", sendAsk);
askCancel.addEventListener("click", () => { if (listening) recognizer?.stop(); closeOverlay(askOverlay); });

// Settings dialog
settingsSave.addEventListener("click", saveSettings);
settingsCancel.addEventListener("click", () => closeOverlay(settingsOverlay));

// Enhance panel
zoom.addEventListener("input", onZoom);
enhanceReset.addEventListener("click", resetEnhancements);
enhanceClose.addEventListener("click", () => closeOverlay(enhancePanel));
enhancePanel.addEventListener("click", (e) => {
  const t = e.target.closest(".toggle");
  if (t) onFilterToggle(t);
});

// Tap the dark backdrop to dismiss any full overlay.
[resultOverlay, askOverlay, settingsOverlay].forEach((ov) => {
  ov.addEventListener("click", (e) => {
    if (e.target !== ov) return;
    if (ov === resultOverlay) { currentAbort?.abort(); stopSpeaking(); }
    if (ov === askOverlay && listening) recognizer?.stop();
    closeOverlay(ov);
  });
});

// Escape closes whatever is open.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  [resultOverlay, askOverlay, settingsOverlay, enhancePanel].forEach((ov) => {
    if (!ov.hidden) {
      if (ov === resultOverlay) { currentAbort?.abort(); stopSpeaking(); }
      closeOverlay(ov);
    }
  });
});

bindVisibility();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  onReady();
}
