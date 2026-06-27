/* =========================================================================
   explore.js — EYES-FREE "explore by touch".

   The problem: a blind user who is NOT running a screen reader can't see the
   buttons, so they can't choose anything. This recreates the core VoiceOver /
   TalkBack gesture inside the app itself:

       • Slide a finger around the screen  → the button under your finger is
         spoken aloud (with a tiny haptic tick).
       • Lift your finger                  → that button is activated.
       • A quick tap (no sliding)          → behaves as a normal tap, so
         sighted users are unaffected and mouse users never trigger it.

   When a real screen reader IS active it intercepts touch events, so these
   handlers simply don't fire — the two never fight.
   ========================================================================= */

export function enableExploreByTouch({ speak, vibrate }) {
  const MOVE_THRESHOLD = 12; // px before a press becomes an "explore" drag
  let active = false;
  let exploring = false;
  let startX = 0, startY = 0;
  let lastLabel = "";
  let suppressTrustedClicksUntil = 0;

  // Strip emoji/symbols so spoken labels are clean ("🔊 Repeat" → "Repeat").
  const SYMBOLS =
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu;
  const clean = (s) => (s || "").replace(SYMBOLS, "").replace(/\s+/g, " ").trim();

  // Areas where native dragging must win (sliders, the map, text entry).
  const NATIVE = "#map, input, textarea, select, .slider";

  function actionableAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest(NATIVE)) return null;
    const a = el.closest("button, [data-task], [data-open]");
    if (!a || a.disabled || a.hidden || a.closest("[hidden]")) return null;
    return a;
  }

  function labelFor(a) {
    const text = a.querySelector(".action__text")?.textContent || a.textContent;
    let label = clean(a.getAttribute("aria-label") || text);
    const pressed = a.getAttribute("aria-pressed");
    if (pressed === "true") label += ", on";
    else if (pressed === "false") label += ", off";
    return label;
  }

  function onDown(e) {
    if (e.pointerType === "mouse") return;          // mouse users opt out
    if (e.target.closest(NATIVE)) return;           // let native controls work
    active = true;
    exploring = false;
    startX = e.clientX;
    startY = e.clientY;
    lastLabel = "";
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { passive: false });
    window.addEventListener("pointercancel", onUp, { passive: false });
  }

  function onMove(e) {
    if (!active) return;
    if (!exploring) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < MOVE_THRESHOLD) return;
      exploring = true; // promoted from "maybe tap" to "exploring"
    }
    e.preventDefault(); // hold position steady while exploring
    const a = actionableAt(e.clientX, e.clientY);
    const label = a ? labelFor(a) : "";
    if (label && label !== lastLabel) {
      lastLabel = label;
      vibrate(8);
      speak(label);
    } else if (!a) {
      lastLabel = "";
    }
  }

  function onUp(e) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    const wasExploring = exploring;
    active = false;
    exploring = false;
    if (!wasExploring) return; // plain tap → let the native click proceed
    e.preventDefault();
    const a = actionableAt(e.clientX, e.clientY);
    if (a) {
      suppressTrustedClicksUntil = Date.now() + 800;
      a.click(); // programmatic (untrusted) → runs handlers, isn't suppressed
    }
    lastLabel = "";
  }

  // Swallow the real (trusted) click the browser fires after an explore lift,
  // so we don't activate twice. Our own a.click() is untrusted and passes.
  document.addEventListener(
    "click",
    (e) => {
      if (e.isTrusted && Date.now() < suppressTrustedClicksUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  window.addEventListener("pointerdown", onDown, { passive: true });
}
