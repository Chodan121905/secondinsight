/* =========================================================================
   camera.js — rear camera start + frame capture + Enhance (zoom/filters).
   Capture always uses the RAW video frame (CSS filters/zoom are visual only),
   so the vision model sees true, unaltered pixels.
   ========================================================================= */

let stream = null;

export function isSecure() {
  return window.isSecureContext &&
         !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function startCamera(video) {
  if (!isSecure()) {
    const err = new Error("insecure");
    err.name = "InsecureContextError";
    throw err;
  }
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" }, // rear camera = points at the world
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play().catch(() => {}); // iOS needs explicit play() after gesture
  return stream;
}

// Pause/resume the track when the tab is hidden (battery + privacy).
export function bindVisibility() {
  document.addEventListener("visibilitychange", () => {
    if (!stream) return;
    const on = !document.hidden;
    stream.getVideoTracks().forEach((t) => (t.enabled = on));
  });
}

// Capture the current frame as a JPEG data URL, scaled down so uploads are
// fast. Text-heavy tasks ask for a larger frame to keep small print legible.
export function captureFrame(video, maxDim = 1280, quality = 0.72) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

// ---- Enhance (visual-only) ----------------------------------------------

const FILTER_CLASS = {
  contrast:  "f-contrast",
  bright:    "f-bright",
  grayscale: "f-grayscale",
  invert:    "f-invert",
};

export function setFilter(video, name, on) {
  const cls = FILTER_CLASS[name];
  if (cls) video.classList.toggle(cls, on);
}

export function setZoom(video, factor) {
  video.style.transform = `scale(${factor})`;
}

export function resetEnhance(video) {
  Object.values(FILTER_CLASS).forEach((c) => video.classList.remove(c));
  video.style.transform = "scale(1)";
}
