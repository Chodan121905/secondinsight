/* =========================================================================
   Second Sight — app.js
   -------------------------------------------------------------------------
   STEP 1: get the rear camera live on a real phone over HTTPS.
   Kept intentionally small and dependency-free so it can be debugged live.
   Later steps (enhance filters, vision calls, speech, settings) layer on top.
   ========================================================================= */

(function () {
  "use strict";

  // ---- Element handles --------------------------------------------------
  const video    = document.getElementById("camera");
  const startBtn  = document.getElementById("startBtn"); // the full-stage gate
  const statusEl  = document.getElementById("status");

  // Keep the active stream so we can stop/restart cleanly later.
  let stream = null;
  let welcomed = false; // have we spoken the welcome yet?

  // ---- Tiny feedback helpers (voice-first from the very first screen) ----

  // Speak a short message aloud. Wrapped in try/catch because SpeechSynthesis
  // is unavailable or blocked in some embedded webviews.
  function speak(text) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.lang = "en-US";
      window.speechSynthesis.speak(u);
    } catch (_) {
      /* speech is a non-critical enhancement; never let it throw */
    }
  }

  // Short haptic tap where supported (Android Chrome). No-op on iOS Safari.
  function buzz(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (_) {}
  }

  // Update the on-screen caption. `tone` drives the color treatment and
  // whether we announce it aloud.
  function setStatus(text, tone) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (tone ? " status--" + tone : "");
    if (tone === "error") {
      buzz([120, 60, 120]);
      speak(text);
    } else if (tone === "ok") {
      buzz(40);
      speak(text);
    }
  }

  // ---- Camera ------------------------------------------------------------

  async function startCamera() {
    // Guard: getUserMedia only exists in secure contexts (HTTPS / localhost).
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus(
        "Camera needs a secure HTTPS connection. Open this page over https.",
        "error"
      );
      return;
    }

    startBtn.disabled = true;
    setStatus("Starting camera…", "active");

    // Prefer the rear ("environment") camera — that's what a user points at
    // the world. `ideal` (not `exact`) so devices with only a front camera
    // still work instead of hard-failing.
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width:  { ideal: 1920 },
        height: { ideal: 1080 },
      },
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;

      // iOS Safari needs an explicit play() after the user gesture.
      await video.play().catch(() => {});

      startBtn.hidden = true;
      // Tell a non-sighted user what to do next, not just that it "worked".
      setStatus("Camera ready. Point it at what you want help with.", "ok");

      // Clear the caption after a moment so it doesn't sit on screen.
      setTimeout(() => {
        if (statusEl.textContent.startsWith("Camera ready")) setStatus("");
      }, 3500);
    } catch (err) {
      startBtn.disabled = false;
      reportCameraError(err);
    }
  }

  // Turn raw getUserMedia errors into plain-language, spoken guidance.
  function reportCameraError(err) {
    const name = err && err.name ? err.name : "";
    let msg;
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        msg =
          "Camera permission was blocked. Allow camera access in your " +
          "browser settings, then tap Start camera again.";
        break;
      case "NotFoundError":
      case "OverconstrainedError":
        msg = "No usable camera was found on this device.";
        break;
      case "NotReadableError":
        msg =
          "The camera is busy in another app. Close it and tap Start " +
          "camera again.";
        break;
      default:
        msg = "Could not start the camera. Tap Start camera to try again.";
    }
    setStatus(msg, "error");
  }

  // Pause the stream when the tab is hidden; resume when it returns. Saves
  // battery and avoids the camera staying "on" in the background.
  document.addEventListener("visibilitychange", () => {
    if (!stream) return;
    const on = !document.hidden;
    stream.getVideoTracks().forEach((t) => (t.enabled = on));
  });

  // ---- Welcome / onboarding (blind-first) --------------------------------
  // A blind user needs to hear what to do. Two safety nets:
  //  1) Screen reader: we focus the big Start button on load, so VoiceOver /
  //     TalkBack immediately read "Start camera … double-tap anywhere…".
  //  2) Self-voicing: we also try to speak a welcome ourselves, for users who
  //     aren't running a screen reader. Mobile browsers block speech before
  //     the first gesture, so if the load-time attempt is muted we speak it
  //     on the very first touch instead — well before the camera opens.
  const WELCOME =
    "Welcome to Second Sight, a spare pair of eyes. " +
    "Tap anywhere on the screen to start your camera.";

  function welcome() {
    if (welcomed) return;
    welcomed = true;
    speak(WELCOME);
  }

  function onReady() {
    // Move focus to the start control so the screen reader announces it.
    try { startBtn.focus({ preventScroll: true }); } catch (_) { startBtn.focus(); }
    // Best-effort spoken welcome (may be blocked until first gesture).
    welcome();
  }

  // If the welcome was blocked pre-gesture, guarantee it on first touch.
  window.addEventListener("pointerdown", welcome, { once: true });

  // ---- Wire up -----------------------------------------------------------
  startBtn.addEventListener("click", startCamera);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
})();
