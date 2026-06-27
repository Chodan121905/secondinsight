/* =========================================================================
   app.js — wiring. State + DOM glue live here; the real work lives in
   camera.js / vision.js / speech.js / maps.js (one concern each).

   NOTE ON THE CAMERA: camera.js is the ONLY module that touches the video
   source. Today it's the phone's rear camera (a prototype input); swapping in
   a future IoT / remote camera means feeding that stream into the same
   <video> there — nothing else in the app needs to change.
   ========================================================================= */

import { startCamera, captureFrame, bindVisibility, isSecure,
         setFilter, setZoom, resetEnhance,
         supportsTorch, setTorch, isTorchOn, frameBrightness } from "./camera.js";
import { analyzeImage, exaEnrich, TASKS, taskTitle } from "./vision.js";
import { speak, stopSpeaking, vibrate, voiceInputSupported, createRecognizer,
         earcon, ensureAudio, setSpeechRate } from "./speech.js";
import { loadMap, getCurrentPosition, getMap,
         planWalkingRoute, renderRoute } from "./maps.js";

// ---- In-memory session keys (never persisted) ---------------------------
const keys = { openai: "", exa: "", ors: "" };

// ---- Element handles -----------------------------------------------------
const $ = (id) => document.getElementById(id);
const video      = $("camera");
const startBtn   = $("startBtn");
const tapCapture = $("tapCapture");
const statusEl   = $("status");
const actions    = $("actions");

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

const navOverlay = $("navOverlay");
const navMic      = $("navMic");
const navMicLabel = $("navMicLabel");
const navHeard    = $("navHeard");
const navInput    = $("navInput");
const navGo       = $("navGo");
const navCancel   = $("navCancel");

const routeOverlay     = $("routeOverlay");
const routeThinking    = $("routeThinking");
const routeThinkingText= $("routeThinkingText");
const mapEl            = $("map");
const routeSummary     = $("routeSummary");
const routeStep        = $("routeStep");
const routePrev        = $("routePrev");
const routeRepeat      = $("routeRepeat");
const routeNext        = $("routeNext");
const routeClose       = $("routeClose");

const settingsOverlay = $("settingsOverlay");
const openaiKey   = $("openaiKey");
const exaKey      = $("exaKey");
const orsKey      = $("orsKey");
const speechRate  = $("speechRate");
const settingsSave   = $("settingsSave");
const settingsCancel = $("settingsCancel");

const enhancePanel = $("enhancePanel");
const zoom         = $("zoom");
const zoomValue    = $("zoomValue");
const torchBtn     = $("torchBtn");
const enhanceReset = $("enhanceReset");
const enhanceClose = $("enhanceClose");

// Overlays/panels that should suppress the tap-to-describe camera target.
const MODALS = () => [resultOverlay, askOverlay, navOverlay, routeOverlay, settingsOverlay, enhancePanel];
const anyModalOpen = () => MODALS().some((o) => !o.hidden);

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

function needKey(which) {
  const names = { openai: "OpenAI", ors: "free OpenRouteService" };
  setStatus(`Add your ${names[which]} key in Settings to use this.`, "error");
  openSettings();
}

// ---- Reusable voice-input controller (Ask + Navigate share this) --------
// Voice in is flaky/absent on iOS Safari, so a typed field is always present;
// this just layers spoken capture on top of it.
function makeVoiceControl({ btn, label, heard, input }) {
  let rec = null;
  let on = false;
  function setOn(v) {
    on = v;
    btn.classList.toggle("is-listening", v);
    label.textContent = v ? "Listening… tap to stop" : "Tap to speak";
    earcon(v ? "listen" : "stoplisten");
    if (v) vibrate(40);
  }
  return {
    toggle() {
      if (!voiceInputSupported) return;
      if (on) { rec && rec.stop(); return; }
      rec = createRecognizer({
        onInterim: (t) => { heard.textContent = t; input.value = t; },
        onFinal:   (t) => { heard.textContent = t; input.value = t; },
        onError:   (m) => { setOn(false); heard.textContent = m; speak(m); },
        onEnd:     () => setOn(false),
      });
      if (!rec) return;
      setOn(true);
      rec.start();
    },
    stop() { if (on && rec) rec.stop(); },
    isOn() { return on; },
    markUnsupported() { btn.disabled = true; label.textContent = "Voice not supported — type below"; },
  };
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
    tapCapture.hidden = false;
    actions.hidden = false;
    earcon("success");
    setStatus("Camera ready. Tap the camera to describe what you see, or choose an action below.", "ok");
    setTimeout(() => { if (statusEl.textContent.startsWith("Camera ready")) setStatus(""); }, 5000);
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
    case "InsecureContextError": msg = "Camera needs a secure HTTPS connection."; break;
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
  if (!keys.openai) { needKey("openai"); return; }
  const cfg = TASKS[task] || TASKS.describe;

  resultExtra.hidden = true;
  resultExtra.textContent = "";
  resultText.textContent = "";
  resultTitle.textContent = taskTitle(task);
  thinkingText.textContent = "Looking…";
  thinking.hidden = false;
  replayBtn.disabled = true;
  openOverlay(resultOverlay, resultClose);

  // Capture first (instant) so we can give immediate "captured" feedback and
  // check the lighting before the slower network round-trip.
  let imageDataUrl;
  try {
    imageDataUrl = captureFrame(video, cfg.maxDim);
  } catch (_) {
    return showResultError("Couldn't capture a frame from the camera. Try again.");
  }
  vibrate(30);
  earcon("capture");

  // Reading text in the dark is a top blind-user failure mode — warn early so
  // they can turn on the flashlight (Enhance) and retake.
  const textTask = task === "read" || task === "medicine" || task === "translate";
  let intro = cfg.title + "…";
  if (textTask && !isTorchOn() && frameBrightness(video) < 55) {
    intro += " It looks dark. Turning on the flashlight in Enhance may help.";
  }
  speak(intro); // confirm the chosen action aloud immediately

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
  earcon("success");
  speak(text);
}
function showResultError(message) {
  thinking.hidden = true;
  resultText.textContent = message;
  resultTitle.textContent = "Sorry";
  lastResultText = message;
  replayBtn.disabled = false;
  vibrate([120, 60, 120]);
  earcon("error");
  speak(message);
}
async function enrich(labelText) {
  try {
    const extra = await exaEnrich({ labelText, apiKey: keys.exa });
    if (!extra) return;
    resultExtra.hidden = false;
    resultExtra.textContent = "More info: " + extra;
    speak(extra, { interrupt: false });
  } catch (_) {}
}

// ---- Ask dialog ----------------------------------------------------------
const askVoice = makeVoiceControl({ btn: micBtn, label: micLabel, heard: askHeard, input: askInput });
function openAsk() {
  askHeard.textContent = "";
  askInput.value = "";
  openOverlay(askOverlay, voiceInputSupported ? micBtn : askInput);
}
function sendAsk() {
  askVoice.stop();
  const q = askInput.value.trim();
  if (!q) { speak("Please say or type a question first."); askInput.focus(); return; }
  closeOverlay(askOverlay);
  runTask("ask", q);
}

// ---- Navigate ------------------------------------------------------------
const navVoice = makeVoiceControl({ btn: navMic, label: navMicLabel, heard: navHeard, input: navInput });
let routeSteps = [];
let stepIdx = 0;
let destName = "";

function openNavigate() {
  if (!keys.ors) { needKey("ors"); return; }
  navHeard.textContent = "";
  navInput.value = "";
  openOverlay(navOverlay, voiceInputSupported ? navMic : navInput);
}

async function goNavigate() {
  navVoice.stop();
  const dest = navInput.value.trim();
  if (!dest) { speak("Please say or type where you want to go."); navInput.focus(); return; }
  closeOverlay(navOverlay);

  // Open the route sheet in a thinking state.
  routeSteps = []; stepIdx = 0;
  routeSummary.hidden = true; routeSummary.textContent = "";
  routeStep.textContent = "";
  mapEl.hidden = true;
  setRouteThinking("Finding the best walking route…", false);
  openOverlay(routeOverlay, routeClose);
  speak("Finding the best walking route to " + dest + ".");

  try {
    const L = await loadMap(); // map needs no key
    setRouteThinking("Getting your location…");
    const origin = await getCurrentPosition();
    setRouteThinking("Finding the best walking route…");
    const mapObj = getMap(L, mapEl, origin);
    mapEl.hidden = false;
    const route = await planWalkingRoute(keys.ors, origin, dest);
    renderRoute(L, mapObj, route.coords, origin, route.dest);
    showRoute(route);
  } catch (err) {
    showRouteError(err.message || "Couldn't get directions. Try again.");
  }
}

function setRouteThinking(text, show = true) {
  routeThinkingText.textContent = text;
  routeThinking.hidden = !show;
}

function showRoute(route) {
  routeThinking.hidden = true;
  routeSteps = route.steps && route.steps.length ? route.steps : [];
  destName = route.destinationName || "your destination";
  stepIdx = 0;

  const summary =
    `Walking route to ${destName}. About ${route.distanceText}, ${route.durationText}. ` +
    `${routeSteps.length} step${routeSteps.length === 1 ? "" : "s"}.`;
  routeSummary.hidden = false;
  routeSummary.textContent = summary;

  if (!routeSteps.length) {
    routeStep.textContent = "No detailed steps were returned. Follow the map.";
    speak(summary, { interrupt: false });
    routePrev.disabled = routeNext.disabled = true;
    return;
  }
  speak(summary);
  showStep(0, false); // queue first step after the summary
}

function showStep(i, interrupt = true) {
  stepIdx = Math.max(0, Math.min(i, routeSteps.length - 1));
  const s = routeSteps[stepIdx];
  const label =
    `Step ${stepIdx + 1} of ${routeSteps.length}. ${s.text}` +
    (s.distance ? ` (${s.distance})` : "");
  routeStep.textContent = label;
  routePrev.disabled = stepIdx === 0;
  routeNext.disabled = false; // last press announces arrival
  speak(label, { interrupt });
}

function nextStep() {
  if (stepIdx < routeSteps.length - 1) {
    showStep(stepIdx + 1);
  } else {
    const msg = `That's the last step. You should arrive at ${destName}.`;
    routeStep.textContent = msg;
    routeNext.disabled = true;
    vibrate([40, 40, 40]);
    earcon("arrive");
    speak(msg);
  }
}
function showRouteError(message) {
  routeThinking.hidden = true;
  mapEl.hidden = true;
  routeSummary.hidden = true;
  routeStep.textContent = message;
  routePrev.disabled = routeNext.disabled = true;
  vibrate([120, 60, 120]);
  speak(message);
}

// ---- Settings ------------------------------------------------------------
let speechRatePref = "1";
function openSettings() {
  openaiKey.value = keys.openai;
  exaKey.value = keys.exa;
  orsKey.value = keys.ors;
  speechRate.value = speechRatePref;
  openOverlay(settingsOverlay, openaiKey);
}
function saveSettings() {
  keys.openai = openaiKey.value.trim();
  keys.exa = exaKey.value.trim();
  keys.ors = orsKey.value.trim();
  speechRatePref = speechRate.value;
  setSpeechRate(speechRatePref);
  closeOverlay(settingsOverlay);
  setStatus(keys.openai ? "Settings saved." : "Saved, but no OpenAI key set yet.", "ok");
}

// ---- Enhance (no network) ------------------------------------------------
function openEnhance() {
  // Only offer the flashlight where the camera hardware actually supports it.
  if (supportsTorch()) {
    torchBtn.hidden = false;
    torchBtn.setAttribute("aria-pressed", String(isTorchOn()));
  } else {
    torchBtn.hidden = true;
  }
  openOverlay(enhancePanel, enhanceClose);
}
async function toggleTorch() {
  const want = !isTorchOn();
  const ok = await setTorch(want);
  if (ok) {
    torchBtn.setAttribute("aria-pressed", String(want));
    speak(want ? "Flashlight on." : "Flashlight off.");
  } else {
    speak("Sorry, the flashlight isn't available on this camera.");
  }
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
function welcome() { if (!welcomed) { welcomed = true; ensureAudio(); speak(WELCOME); } }
function onReady() {
  try { startBtn.focus({ preventScroll: true }); } catch (_) { startBtn.focus(); }
  if (!voiceInputSupported) { askVoice.markUnsupported(); navVoice.markUnsupported(); }
  welcome();
}

// ---- Wire up -------------------------------------------------------------
startBtn.addEventListener("click", start);
window.addEventListener("pointerdown", welcome, { once: true });

actions.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.task) return runTask(btn.dataset.task);
  switch (btn.dataset.open) {
    case "ask":      return openAsk();
    case "navigate": return openNavigate();
    case "enhance":  return openEnhance();
    case "settings": return openSettings();
  }
});

// Result dialog
replayBtn.addEventListener("click", () => speak(lastResultText));
resultClose.addEventListener("click", () => { currentAbort?.abort(); stopSpeaking(); closeOverlay(resultOverlay); });

// Ask dialog
micBtn.addEventListener("click", () => askVoice.toggle());
askSend.addEventListener("click", sendAsk);
askCancel.addEventListener("click", () => { askVoice.stop(); closeOverlay(askOverlay); });

// Navigate dialog
navMic.addEventListener("click", () => navVoice.toggle());
navGo.addEventListener("click", goNavigate);
navCancel.addEventListener("click", () => { navVoice.stop(); closeOverlay(navOverlay); });

// Route stepper
routeNext.addEventListener("click", nextStep);
routePrev.addEventListener("click", () => showStep(stepIdx - 1));
routeRepeat.addEventListener("click", () => routeSteps.length && showStep(stepIdx));
routeClose.addEventListener("click", () => { stopSpeaking(); closeOverlay(routeOverlay); });

// Tap the camera itself to Describe (biggest, easiest non-visual target).
tapCapture.addEventListener("click", () => { if (!anyModalOpen()) runTask("describe"); });

// Settings dialog
settingsSave.addEventListener("click", saveSettings);
settingsCancel.addEventListener("click", () => { setSpeechRate(speechRatePref); closeOverlay(settingsOverlay); });
// Live preview: hear the new speed the instant it changes.
speechRate.addEventListener("change", () => { setSpeechRate(speechRate.value); speak("This is the speech speed."); });

// Enhance panel
zoom.addEventListener("input", onZoom);
torchBtn.addEventListener("click", toggleTorch);
enhanceReset.addEventListener("click", resetEnhancements);
enhanceClose.addEventListener("click", () => closeOverlay(enhancePanel));
enhancePanel.addEventListener("click", (e) => {
  const t = e.target.closest(".toggle[data-filter]"); // torchBtn handled separately
  if (t) onFilterToggle(t);
});

// Tap the dark backdrop to dismiss a full overlay.
[resultOverlay, askOverlay, navOverlay, routeOverlay, settingsOverlay].forEach((ov) => {
  ov.addEventListener("click", (e) => {
    if (e.target !== ov) return;
    if (ov === resultOverlay) { currentAbort?.abort(); stopSpeaking(); }
    if (ov === routeOverlay) stopSpeaking();
    if (ov === askOverlay) askVoice.stop();
    if (ov === navOverlay) navVoice.stop();
    closeOverlay(ov);
  });
});

// Escape closes whatever is open.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  [resultOverlay, askOverlay, navOverlay, routeOverlay, settingsOverlay, enhancePanel].forEach((ov) => {
    if (!ov.hidden) {
      if (ov === resultOverlay) { currentAbort?.abort(); stopSpeaking(); }
      if (ov === routeOverlay) stopSpeaking();
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
