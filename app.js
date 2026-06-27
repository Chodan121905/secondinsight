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
import { TASKS, taskTitle } from "./vision.js";
import { speak, stopSpeaking, vibrate, voiceInputSupported, createRecognizer,
         earcon, ensureAudio, setSpeechRate, isSpeaking, onSpeakStart } from "./speech.js";
import { loadMap, getCurrentPosition, getMap, renderRoute } from "./maps.js";
import { enableExploreByTouch } from "./explore.js";
import { loadDetector, detectFrame, describeDetections, phraseFor, drawBoxes } from "./detect.js";
import { initBackend, backendHas, backendUp, visionViaServer, exaViaServer,
         routeViaServer, postLocation, intentViaServer } from "./backend.js";

// API keys are NOT handled in the front end — they live on the server as
// environment variables and are reached only through the /api/* endpoints.

// ---- Element handles -----------------------------------------------------
const $ = (id) => document.getElementById(id);
const video      = $("camera");
const startBtn   = $("startBtn");
const tapCapture = $("tapCapture");
const overlayCanvas = $("overlay");
const statusEl   = $("status");
const actions    = $("actions");
const pauseBtn   = $("pauseBtn");

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
const speechRate  = $("speechRate");
const serverNote  = $("serverNote");
const noServerNote = $("noServerNote");
const trackName   = $("trackName");
const trackCode   = $("trackCode");
const trackShare  = $("trackShare");
const settingsSave   = $("settingsSave");
const settingsCancel = $("settingsCancel");

const enhancePanel = $("enhancePanel");
const zoom         = $("zoom");
const zoomValue    = $("zoomValue");
const torchBtn     = $("torchBtn");
const enhanceReset = $("enhanceReset");
const enhanceClose = $("enhanceClose");

// Overlays/panels that should suppress the tap-the-camera "Look" target.
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

// Keyed features come from the server. If the backend (or that feature's env
// key) isn't there, say so plainly — there's nothing for the user to paste.
function featureUnavailable(kind) {
  const msg = {
    vision: "AI features aren't set up on the server yet.",
    maps: "Navigation isn't set up on the server yet.",
  };
  setStatus(msg[kind] || "This feature isn't available.", "error");
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
    // Go fully hands-free immediately — no button needed. The on-screen
    // controls stay available for sighted helpers / low-vision users.
    startAuto();
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
  if (!backendHas("vision")) { featureUnavailable("vision"); return; }
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
  // they can turn on the flashlight (Enhance) and retake. `auto` may land on
  // text too, so it gets the same low-light check.
  const textTask = task === "auto" || task === "read" || task === "medicine" || task === "translate";
  let intro = cfg.title + "…";
  if (textTask && !isTorchOn() && frameBrightness(video) < 55) {
    intro += " It looks dark. Turning on the flashlight in Enhance may help.";
  }
  speak(intro); // confirm the chosen action aloud immediately

  currentAbort = new AbortController();
  try {
    const text = await visionViaServer({ task, question, imageDataUrl, signal: currentAbort.signal });
    showResult(text);
    if (task === "medicine") enrich(text);
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
    if (!backendHas("exa")) return;
    const extra = await exaViaServer({ labelText });
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
  speak(voiceInputSupported
    ? "Ask about what you see. Tap to speak your question, or type it."
    : "Ask about what you see. Type your question, then choose Ask.");
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
  if (!backendHas("maps")) { featureUnavailable("maps"); return; }
  navHeard.textContent = "";
  navInput.value = "";
  openOverlay(navOverlay, voiceInputSupported ? navMic : navInput);
  speak(voiceInputSupported
    ? "Where do you want to go? Tap to speak a destination, or type it."
    : "Where do you want to go? Type a destination, then choose Get directions.");
}

function goNavigate() {
  navVoice.stop();
  const dest = navInput.value.trim();
  if (!dest) { speak("Please say or type where you want to go."); navInput.focus(); return; }
  closeOverlay(navOverlay);
  navigateTo(dest);
}

// The actual routing, reused by both the dialog and a spoken "navigate to X".
async function navigateTo(dest) {
  if (!backendHas("maps")) { featureUnavailable("maps"); return; }

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
    const route = await routeViaServer({ origin, query: dest });
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

// ---- Hands-free Auto mode (no buttons needed) ---------------------------
// A blind user can't see buttons, so after the ONE start tap (browsers force a
// gesture before camera + audio can begin) the app runs itself: it watches
// continuously, warns about hazards on-device, narrates the scene through the
// AI, and — where the browser supports it — takes spoken commands. The visible
// buttons become optional, for a sighted helper or a low-vision user who
// prefers tapping.
let autoOn = false;            // engine running
let narrationPaused = false;   // user said "stop / quiet"
let detector = null;
let detectTimer = null;
let narrateTimer = null;
let lastUrgentAt = 0;
let lastUrgentKey = "";        // which hazard we last warned about
let lastRoundupAt = 0;         // last proactive "around you" summary
let lastRoundupSig = "";       // what that summary contained (skip repeats)
let lastDets = [];             // most recent detections
let lastNarration = "";

function startAuto() {
  if (autoOn) return;
  autoOn = true;
  narrationPaused = false;
  overlayCanvas.hidden = false;
  lastNarration = "";
  lastRoundupAt = 0;
  lastRoundupSig = "";
  lastUrgentKey = "";
  setStatus("Watching. I'll tell you what's around you — no buttons needed.", "active");

  let intro = "I'm watching now. I'll keep telling you what's around you on my " +
              "own — you don't have to ask or press anything.";
  if (!backendUp())
    intro += " The AI server isn't connected, so right now I can only warn you " +
             "about nearby objects.";
  if (voiceInputSupported)
    intro += " You can also talk to me — say 'help' to hear what you can ask.";
  speak(intro);

  // On-device hazard detection (optional; AI narration still runs without it).
  loadDetector()
    .then((m) => { detector = m; detectLoop(); })
    .catch(() => { /* detection unavailable; narration still works */ });
  narrateLoop(true);  // first AI narration shortly after start
  startVoice();       // spoken commands where the browser supports them
}

// Pause the whole hands-free engine while the tab/app is backgrounded — no
// point burning API calls or warning an empty room — and resume on return.
function suspendAuto() {
  if (detectTimer)  { clearTimeout(detectTimer);  detectTimer = null; }
  if (narrateTimer) { clearTimeout(narrateTimer); narrateTimer = null; }
  stopVoice();
  stopSpeaking();
}
function resumeAuto() {
  if (detector) detectLoop();
  if (!narrationPaused) narrateLoop(true);
  startVoice();
}

function setPaused(p) {
  narrationPaused = p;
  pauseBtn.setAttribute("aria-pressed", String(p));
  const t = pauseBtn.querySelector(".action__text");
  if (t) t.textContent = p ? "Resume" : "Pause";
  if (p) {
    stopSpeaking(); earcon("stoplisten");
    setStatus("Paused. Say 'start', or choose Resume.", "ok");
    speak("Paused.");
  } else {
    earcon("listen");
    setStatus("Back on. I'll keep describing what I see.", "active");
    speak("Okay, back on.");
    narrateLoop(true);
  }
}
function togglePause() {
  if (!autoOn) return startAuto();
  setPaused(!narrationPaused);
}

// --- On-device hazard loop (fast, no network) ---
async function detectLoop() {
  if (!autoOn || !detector) return;
  try {
    const dets = await detectFrame(detector, video);
    lastDets = dets;
    drawBoxes(overlayCanvas, video, dets, 0.5);
    if (!narrationPaused && !anyModalOpen()) {
      const items = describeDetections(dets, video.videoWidth, video.videoHeight, 0.5);
      handleHazards(items);              // imminent danger → interrupt now
      maybeAnnounceSurroundings(items);  // otherwise, volunteer what's around
    }
  } catch (_) { /* skip a bad frame */ }
  if (autoOn) detectTimer = setTimeout(detectLoop, 650);
}

function handleHazards(items) {
  if (!items.length) return;
  const now = Date.now();
  const top = items[0];
  if (!top.urgent) return;
  // Imminent hazard interrupts everything — but don't re-cut speech every
  // second for the SAME close object; only re-warn after it's been quiet a
  // while or a different hazard appears.
  const sameAsLast = top.key === lastUrgentKey && now - lastUrgentAt < 5000;
  if (sameAsLast || now - lastUrgentAt < 2500) return;
  lastUrgentAt = now;
  lastUrgentKey = top.key;
  setStatus(phraseFor(top), "active");
  vibrate([80, 40, 80]);
  earcon("error");
  speak(phraseFor(top), { interrupt: true });
}

// A blind user can't see the boxes and shouldn't have to ASK what's around
// them — so we tell them, on our own: a short spoken roundup of what's nearby,
// at a calm pace, skipping a repeat when the scene hasn't changed.
function maybeAnnounceSurroundings(items) {
  if (!items.length || isSpeaking()) return;
  const now = Date.now();
  if (now - lastUrgentAt < 1500) return;       // let a warning breathe
  if (now - lastRoundupAt < 6500) return;      // unhurried cadence
  const sig = items.slice(0, 3).map((i) => i.key).join("|");
  if (sig === lastRoundupSig && now - lastRoundupAt < 16000) return; // static scene
  lastRoundupAt = now;
  lastRoundupSig = sig;
  const phrase = surroundingsPhrase(items);
  setStatus(phrase, "active");
  speak(phrase, { interrupt: false });
}

// "Around you: a person ahead, a chair on your left, and a door on your right."
function surroundingsPhrase(items) {
  const top = items.slice(0, 3).map((it) => {
    const where = it.pos === "ahead" ? "ahead" : "on your " + it.pos;
    const prox = it.prox === "very close" ? "very close " : "";
    return prox + "a " + it.cls + " " + where;
  });
  if (top.length === 1) return "Around you, there's " + top[0] + ".";
  return "Around you: " + top.slice(0, -1).join(", ") + ", and " + top[top.length - 1] + ".";
}

// --- AI narration loop (periodic, server) ---
function narrateLoop(soon) {
  if (narrateTimer) { clearTimeout(narrateTimer); narrateTimer = null; }
  if (!autoOn) return;
  // The on-device object roundup is the primary, fast "what's around you"
  // channel; the AI narration is a slower layer that adds richer scene context
  // (what people are doing, text, setting), so it runs less often.
  narrateTimer = setTimeout(async () => {
    if (autoOn && !narrationPaused) await narrateOnce();
    if (autoOn) narrateLoop(false);
  }, soon ? 2000 : 16000);
}

async function narrateOnce(force = false) {
  if (!backendHas("vision")) { if (force) speak("The AI server isn't connected, so I can only warn you about nearby objects."); return; }
  if (!force && (isSpeaking() || anyModalOpen())) return; // don't talk over self/dialogs
  if (!force && Date.now() - lastUrgentAt < 2500) return; // just gave a hazard warning
  let img;
  try { img = captureFrame(video, 1024); } catch (_) { return; }
  if (force) { earcon("capture"); vibrate(20); speak("Looking…"); }
  try {
    const text = await visionViaServer({ task: "auto", imageDataUrl: img });
    if (!text || !autoOn) return;
    if (!force && narrationPaused) return;
    if (!force && (isSpeaking() || anyModalOpen())) return;
    if (!force && sameScene(text, lastNarration)) return;  // don't repeat the same thing
    lastNarration = text;
    lastResultText = text;
    setStatus(text, "");
    speak(text, { interrupt: false });
  } catch (_) { /* skip; the next tick tries again */ }
}

// Cheap "is this basically what I just said?" guard to avoid repetition.
function sameScene(a, b) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  return !!b && norm(a).slice(0, 80) === norm(b).slice(0, 80);
}

// Spoken-only version of a focused task (no modal to trap a blind user).
async function speakTask(task, question) {
  if (!backendHas("vision")) { speak("That needs the AI server, which isn't connected."); return; }
  let img;
  try { img = captureFrame(video, (TASKS[task] && TASKS[task].maxDim) || 1280); }
  catch (_) { speak("I couldn't use the camera just now. Try again."); return; }
  earcon("capture"); vibrate(20);
  speak(taskTitle(task) + "…");
  try {
    const text = await visionViaServer({ task, question, imageDataUrl: img });
    if (!text) { speak("I didn't get an answer. Try again."); return; }
    lastResultText = text;
    setStatus(text, "");
    earcon("success");
    speak(text, { interrupt: false });
  } catch (err) {
    earcon("error");
    speak(err.message || "Sorry, that didn't work. Try again.");
  }
}

function announceSurroundings() {
  const items = describeDetections(lastDets, video.videoWidth, video.videoHeight, 0.5);
  if (!items.length) { speak("I don't see anything notable around you right now."); return; }
  lastRoundupAt = Date.now();
  lastRoundupSig = items.slice(0, 3).map((i) => i.key).join("|");
  const phrase = surroundingsPhrase(items);
  setStatus(phrase, "active");
  speak(phrase);
}

// --- Hands-free voice commands (continuous, where supported) ---
// SpeechRecognition stops after each phrase, so we restart it on end to make
// it feel always-on. We hold off while we're speaking to avoid the mic hearing
// our own voice. Absent on most iOS Safari — there the app still narrates
// automatically and a helper can use the on-screen buttons.
let voiceRec = null;
let voiceActive = false;

function startVoice() {
  if (!voiceInputSupported || voiceActive) return;
  voiceActive = true;
  listenChunk();
}
function stopVoice() {
  voiceActive = false;
  if (voiceRec) { try { voiceRec.stop(); } catch (_) {} voiceRec = null; }
}
function listenChunk() {
  if (!voiceActive || !autoOn) return;
  // Wait out our own TTS, and stand down while the Ask/Navigate dialogs are
  // open (they run their own recognizer — two at once conflict).
  if (isSpeaking() || !askOverlay.hidden || !navOverlay.hidden) { setTimeout(listenChunk, 700); return; }
  voiceRec = createRecognizer({
    onFinal: (t) => handleCommand(t),
    onError: (m) => {
      // A blocked mic would otherwise restart in a tight loop — stop voice and
      // carry on narrating. Transient errors (no-speech) just fall through to
      // onEnd, which restarts listening.
      if (/permission|microphone|no microphone/i.test(m)) {
        voiceActive = false;
        speak("I can't hear you without microphone access, but I'll keep " +
              "describing what I see.", { interrupt: false });
      }
    },
    onEnd:   () => { if (voiceActive && autoOn) setTimeout(listenChunk, 350); },
  });
  if (voiceRec) voiceRec.start();
}

const said = (t, ...words) => words.some((w) => t.includes(w));

// Does this sound like "get me somewhere"? Deliberately broad.
const NAV_INTENT = /\b(navigate|direction|directions|route|take me|bring me|walk|head|get to|drive|where is|where's|how do i get|how to get|find)\b|\bgo\b/;

// Pull the place name out of natural phrasing: "I want to go to Orchard",
// "take me to Orchard Road", "go orchard", "where is the nearest pharmacy".
function extractDestination(t) {
  let dest;
  const i = t.lastIndexOf(" to ");
  if (i >= 0) {
    dest = t.slice(i + 4);                       // text after the last " to "
  } else {
    const m = t.match(/\b(?:navigate|directions?|route|walk|head|drive|go|where is|where's|find)\b\s+(.+)/);
    dest = m ? m[1] : "";
  }
  dest = (dest || "").replace(/\b(please|now|thanks|thank you)\b/g, "").trim();
  // Strip leading filler words ("go the", "to my", …) left over from the phrase.
  while (/^(?:to|the|a|an|go|of|my|some)\s+/.test(dest))
    dest = dest.replace(/^(?:to|the|a|an|go|of|my|some)\s+/, "");
  return dest.trim();
}

async function handleCommand(raw) {
  const t = (raw || "").toLowerCase().trim();
  if (!t) return;
  setStatus("Heard: " + t, "");

  // Instant, latency/safety-critical commands — never wait on the network for
  // these (you want "stop" to be immediate).
  if (!routeOverlay.hidden) {
    if (said(t, "next", "forward"))   return nextStep();
    if (said(t, "back", "previous"))  return showStep(stepIdx - 1);
    if (said(t, "repeat", "again"))   return routeSteps.length && showStep(stepIdx);
    if (said(t, "done", "close", "cancel", "exit", "finish")) {
      stopSpeaking(); closeOverlay(routeOverlay); return;
    }
  }
  if (said(t, "stop", "quiet", "silence", "shut up", "pause", "hush"))  return setPaused(true);
  if (said(t, "start", "resume", "continue", "carry on", "go on", "wake up"))
    return narrationPaused ? setPaused(false) : narrateLoop(true);
  if (said(t, "help", "what can i say", "what can you do", "commands"))  return sayHelp();

  // Smarter routing: let the AI (OpenAI key on the server) interpret ANY
  // phrasing — "i wanna head down to orchard", "is this my heart pills" — and
  // map it to an action. Fall back to local keyword matching if the server
  // isn't there or the call fails.
  if (backendHas("vision")) {
    earcon("capture"); // quick tick so the user knows it heard them
    const intent = await intentViaServer({ text: raw });
    if (intent && dispatchIntent(intent, raw)) return;
  }
  handleCommandLocal(t, raw);
}

// Run the structured action the AI returned. Returns true when handled.
function dispatchIntent(intent, raw) {
  switch (intent.action) {
    case "navigate":
      if (intent.destination) navigateTo(intent.destination);
      else speak("Where would you like to go? Say, for example, take me to Orchard Road.");
      return true;
    case "read":      speakTask("read");      return true;
    case "medicine":  speakTask("medicine");  return true;
    case "translate": speakTask("translate"); return true;
    case "describe":  narrateOnce(true);      return true;
    case "around":    announceSurroundings(); return true;
    case "torch":     toggleTorch();          return true;
    case "repeat":    speak(lastResultText || lastNarration || "There's nothing to repeat yet."); return true;
    case "stop":      setPaused(true);        return true;
    case "start":     narrationPaused ? setPaused(false) : narrateLoop(true); return true;
    case "help":      sayHelp();              return true;
    case "ask":       speakTask("ask", intent.question || raw); return true;
    default:          return false;
  }
}

// Keyword fallback for when the AI intent parser isn't available (static
// hosting, or the call failed).
function handleCommandLocal(t, raw) {
  if (NAV_INTENT.test(t)) {
    const dest = extractDestination(t);
    if (dest) return navigateTo(dest);
    return speak("Where would you like to go? Say, for example, take me to Orchard Road.");
  }
  if (said(t, "around", "near me", "nearby", "surroundings"))           return announceSurroundings();
  if (said(t, "medicine", "medication", "pill", "tablet", "prescription")) return speakTask("medicine");
  if (said(t, "translate", "translation"))                             return speakTask("translate");
  if (said(t, "read"))                                                 return speakTask("read");
  if (said(t, "torch", "flashlight", "light", "brighter", "too dark")) return toggleTorch();
  if (said(t, "repeat", "again", "say that again", "replay"))
    return speak(lastResultText || lastNarration || "There's nothing to repeat yet.");
  if (said(t, "describe", "look", "what's this", "what is this", "what do you see",
           "in front", "what's that", "what am i looking at"))
    return narrateOnce(true);

  // Anything else: treat it as a question about what the camera sees.
  speakTask("ask", raw);
}

function sayHelp() {
  speak(
    "You don't have to press anything, and you don't have to ask what's around " +
    "you — I tell you that on my own and warn you about anything close. " +
    "If you want more, you can say: describe, to hear what's in front of you. " +
    "Read, to read text. Medicine, for a medicine label. Translate, for a sign " +
    "in another language. Navigate to a place, for walking directions. Or just " +
    "ask a question. Say stop to quiet me, and start to resume."
  );
}

// ---- Family location sharing --------------------------------------------
// When enabled (and a backend is present), the device posts its GPS so family
// can follow along on /family. Memory-only prefs.
const tracking = { name: "", code: "", share: false };
let geoWatchId = null;
let lastLocPost = 0;

function applyTracking() {
  const want = tracking.share && tracking.code && backendUp();
  if (want && geoWatchId == null && navigator.geolocation) {
    geoWatchId = navigator.geolocation.watchPosition(onLocation, () => {},
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 });
    speak("Location sharing is on.");
  } else if (!want && geoWatchId != null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}
function onLocation(p) {
  const now = Date.now();
  if (now - lastLocPost < 5000) return; // throttle posts to ~once per 5s
  lastLocPost = now;
  postLocation({ code: tracking.code, name: tracking.name, lat: p.coords.latitude, lng: p.coords.longitude });
}

// ---- Settings ------------------------------------------------------------
let speechRatePref = "1";
function openSettings() {
  serverNote.hidden = !backendUp();
  noServerNote.hidden = backendUp();
  speechRate.value = speechRatePref;
  trackName.value = tracking.name;
  trackCode.value = tracking.code;
  trackShare.checked = tracking.share;
  openOverlay(settingsOverlay, speechRate);
}
function saveSettings() {
  speechRatePref = speechRate.value;
  setSpeechRate(speechRatePref);
  tracking.name = trackName.value.trim();
  tracking.code = trackCode.value.trim();
  tracking.share = trackShare.checked;
  applyTracking();
  closeOverlay(settingsOverlay);
  setStatus("Settings saved.", "ok");
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
  "Tap anywhere on the screen once to start. " +
  "After that you don't have to press anything — I'll watch and tell you what's " +
  "around you on my own, and warn you about anything close. " +
  "You can also just talk to me; say 'help' any time to hear what you can ask.";
function welcome() { if (!welcomed) { welcomed = true; ensureAudio(); speak(WELCOME); } }
function onReady() {
  try { startBtn.focus({ preventScroll: true }); } catch (_) { startBtn.focus(); }
  if (!voiceInputSupported) { askVoice.markUnsupported(); navVoice.markUnsupported(); }
  // Don't speak here: at load there's been no user gesture, so iOS would block
  // (and silently "use up") this first utterance, leaving the engine locked.
  // The welcome speaks on the first tap instead (a gesture), which unlocks TTS.
}

// ---- Wire up -------------------------------------------------------------
startBtn.addEventListener("click", start);
window.addEventListener("pointerdown", welcome, { once: true });

actions.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.task) return runTask(btn.dataset.task);
  switch (btn.dataset.open) {
    case "pause":    return togglePause();
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

// The app narrates on its own, but tapping the camera forces an immediate
// "Look" — handy if the user wants an answer right now without waiting.
tapCapture.addEventListener("click", () => { if (!anyModalOpen()) { stopSpeaking(); narrateOnce(true); } });

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

// The moment we start speaking, drop the mic so it can't hear our own voice
// (which both garbles recognition and can clip our speech on some phones). The
// listen loop resumes on its own once we're quiet again.
onSpeakStart(() => { if (voiceRec) { try { voiceRec.stop(); } catch (_) {} } });

bindVisibility();
// Suspend/resume the hands-free engine with the tab so it doesn't run (or pay
// for vision calls) while the app is in the background.
document.addEventListener("visibilitychange", () => {
  if (!autoOn) return;
  if (document.hidden) suspendAuto(); else resumeAuto();
});
enableExploreByTouch({ speak, vibrate }); // eyes-free: slide to hear, lift to choose
initBackend(); // discover the server (keys in env); on-device features work without it

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  onReady();
}
