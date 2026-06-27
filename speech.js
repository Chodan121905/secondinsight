/* =========================================================================
   speech.js — voice OUT (SpeechSynthesis), voice IN (SpeechRecognition),
   earcons (short non-speech audio cues), and haptics.

   Why earcons: a blind user who taps and then hears *nothing* doesn't know if
   the app registered the tap. A 150ms sound confirms "captured" / "listening"
   / "done" / "error" instantly, before the slower spoken result arrives.
   Everything is wrapped so a missing/blocked API never throws.
   ========================================================================= */

// ---- Voice out -----------------------------------------------------------

let speechRate = 1.0; // experienced screen-reader users often want this high

export function setSpeechRate(r) {
  const n = parseFloat(r);
  if (!isNaN(n) && n > 0) speechRate = n;
}

export function speak(text, { rate, interrupt = true } = {}) {
  try {
    if (!text || !("speechSynthesis" in window)) return;
    if (interrupt) window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.rate = rate || speechRate;
    u.lang = "en-US";
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

export function stopSpeaking() {
  try { window.speechSynthesis.cancel(); } catch (_) {}
}

// ---- Earcons (Web Audio) -------------------------------------------------

let actx = null;
function audio() {
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  } catch (_) { return null; }
}

// Call once after the first user gesture so earcons aren't blocked later.
export function ensureAudio() { audio(); }

// Each cue is a short tone sequence: [frequencyHz, startOffsetSec, durSec].
const EARCONS = {
  capture:    [[900, 0, 0.05], [1350, 0.055, 0.05]], // crisp double "click"
  listen:     [[523, 0, 0.08], [784, 0.09, 0.11]],   // rising = on
  stoplisten: [[784, 0, 0.08], [523, 0.09, 0.11]],   // falling = off
  success:    [[659, 0, 0.09], [988, 0.1, 0.15]],    // pleasant up-chime
  error:      [[210, 0, 0.16], [150, 0.14, 0.22]],   // low buzz
  arrive:     [[659, 0, 0.1], [880, 0.11, 0.1], [1175, 0.22, 0.16]],
};

export function earcon(name) {
  const c = audio();
  const seq = EARCONS[name];
  if (!c || !seq) return;
  const now = c.currentTime;
  for (const [freq, start, dur] of seq) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g); g.connect(c.destination);
    const t0 = now + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
}

// ---- Haptics -------------------------------------------------------------

export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {}
}

// ---- Voice in ------------------------------------------------------------
// Absent on most iOS Safari builds, so the UI ALWAYS offers a typed fallback.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
export const voiceInputSupported = !!SR;

export function createRecognizer({ onInterim, onFinal, onError, onEnd } = {}) {
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim && onInterim) onInterim(interim.trim());
    if (final && onFinal) onFinal(final.trim());
  };

  rec.onerror = (e) => {
    const map = {
      "not-allowed": "Microphone permission was blocked. You can type instead.",
      "service-not-allowed": "Microphone permission was blocked. You can type instead.",
      "no-speech": "I didn't catch that. Try again, or type it.",
      "audio-capture": "No microphone was found. You can type instead.",
      "network": "Voice recognition needs a network connection. You can type instead.",
    };
    if (onError) onError(map[e.error] || "Voice input failed. You can type instead.");
  };

  rec.onend = () => { if (onEnd) onEnd(); };

  return {
    start() { try { rec.start(); } catch (_) {} },
    stop()  { try { rec.stop();  } catch (_) {} },
  };
}
