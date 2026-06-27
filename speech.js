/* =========================================================================
   speech.js — voice OUT (SpeechSynthesis), voice IN (SpeechRecognition),
   and haptics. All wrapped so a missing/blocked API never throws: speech is
   the product's primary channel, but it must degrade gracefully.
   ========================================================================= */

// ---- Voice out -----------------------------------------------------------

export function speak(text, { rate = 1.0, interrupt = true } = {}) {
  try {
    if (!text || !("speechSynthesis" in window)) return;
    if (interrupt) window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.rate = rate;
    u.lang = "en-US";
    window.speechSynthesis.speak(u);
  } catch (_) {
    /* never let speech crash the app */
  }
}

export function stopSpeaking() {
  try { window.speechSynthesis.cancel(); } catch (_) {}
}

// ---- Haptics -------------------------------------------------------------

export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {}
}

// ---- Voice in ------------------------------------------------------------
// SpeechRecognition is absent on most iOS Safari builds, so the UI ALWAYS
// offers a typed fallback. This factory returns null when unsupported.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
export const voiceInputSupported = !!SR;

// Create a one-shot recognizer. Callbacks: onInterim(text), onFinal(text),
// onError(message), onEnd(). Returns { start(), stop() } or null.
export function createRecognizer({ onInterim, onFinal, onError, onEnd } = {}) {
  if (!SR) return null;

  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    let interim = "";
    let final = "";
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
      "not-allowed": "Microphone permission was blocked. You can type your question instead.",
      "service-not-allowed": "Microphone permission was blocked. You can type your question instead.",
      "no-speech": "I didn't catch that. Try again, or type your question.",
      "audio-capture": "No microphone was found. You can type your question instead.",
      "network": "Voice recognition needs a network connection. You can type your question instead.",
    };
    if (onError) onError(map[e.error] || "Voice input failed. You can type your question instead.");
  };

  rec.onend = () => { if (onEnd) onEnd(); };

  return {
    start() { try { rec.start(); } catch (_) {} },
    stop()  { try { rec.stop();  } catch (_) {} },
  };
}
