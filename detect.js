/* =========================================================================
   detect.js — real-time object awareness for walking ("Around me").

   Uses coco-ssd (MobileNet-SSD), a YOLO-style detector that runs ON-DEVICE in
   the browser via TensorFlow.js: no API key, no cost, and it keeps working
   offline once the model has loaded. Detects the 80 COCO classes — the useful
   street ones being person / bicycle / car / motorcycle / bus / truck / dog /
   traffic light / stop sign / bench, etc.

   This module is deliberately the ONLY place tied to the detection model, so a
   real YOLOv8 ONNX model could be swapped in here later without touching the
   walking UX.
   ========================================================================= */

const TFJS = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const COCO = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";

let modelPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("script load failed"));
    document.head.appendChild(s);
  });
}

// Load TF.js + coco-ssd once (lazily, only when the user starts Around me).
export function loadDetector() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    if (!window.cocoSsd) {
      if (!window.tf) await loadScript(TFJS);
      await loadScript(COCO);
    }
    // lite_mobilenet_v2 = fastest variant, best for phones.
    return await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
  })().catch((e) => {
    modelPromise = null; // allow retry
    throw new Error("Couldn't load object detection. Check your connection and try again.");
  });
  return modelPromise;
}

export async function detectFrame(model, video) {
  return model.detect(video, 20); // up to 20 objects per frame
}

// Classes worth prioritising on a street, with rough importance weights.
const HAZARD = {
  car: 6, bus: 6, truck: 6, motorcycle: 6, train: 6, bicycle: 5,
  person: 5, dog: 4, "traffic light": 3, "stop sign": 3, "fire hydrant": 2,
};

// Turn raw detections into a prioritised, spoken-friendly list with rough
// position (left / ahead / right) and proximity (from how big the box is).
export function describeDetections(dets, vw, vh, scoreMin = 0.5) {
  const items = [];
  for (const d of dets) {
    if (d.score < scoreMin) continue;
    const [x, y, w, h] = d.bbox;
    const cx = x + w / 2;
    const frac = cx / vw;
    const pos = frac < 0.34 ? "left" : frac > 0.66 ? "right" : "ahead";
    const area = (w * h) / (vw * vh);
    const prox = area > 0.45 ? "very close" : area > 0.18 ? "close" : "";
    const base = HAZARD[d.class] || 1;
    const priority = base + (prox === "very close" ? 3 : prox === "close" ? 1.5 : 0);
    items.push({
      cls: d.class, pos, prox, area, score: d.score, priority,
      urgent: prox === "very close" && base >= 4,
      key: d.class + ":" + pos,
    });
  }
  items.sort((a, b) => b.priority - a.priority || b.area - a.area);
  return items;
}

export function phraseFor(it) {
  const name = it.cls.charAt(0).toUpperCase() + it.cls.slice(1);
  const where = it.pos === "ahead" ? "ahead" : "on your " + it.pos;
  return name + " " + where + (it.prox ? ", " + it.prox : "");
}

// Draw boxes for sighted helpers / the demo. Maps intrinsic video pixels to the
// displayed (object-fit: cover) canvas so boxes line up with the live view.
export function drawBoxes(canvas, video, dets, scoreMin = 0.5) {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, cw, ch);

  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(cw / vw, ch / vh);
  const ox = (vw * scale - cw) / 2;
  const oy = (vh * scale - ch) / 2;

  ctx.lineWidth = Math.max(2, cw * 0.006);
  ctx.font = `${Math.round(cw * 0.045)}px "Atkinson Hyperlegible", sans-serif`;
  for (const d of dets) {
    if (d.score < scoreMin) continue;
    const [x, y, w, h] = d.bbox;
    const dx = x * scale - ox, dy = y * scale - oy, dw = w * scale, dh = h * scale;
    ctx.strokeStyle = "#2ee6e6";
    ctx.strokeRect(dx, dy, dw, dh);
    const label = `${d.class} ${Math.round(d.score * 100)}%`;
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = "rgba(4,32,31,0.85)";
    ctx.fillRect(dx, Math.max(0, dy - 24), tw, 24);
    ctx.fillStyle = "#2ee6e6";
    ctx.fillText(label, dx + 5, Math.max(16, dy - 7));
  }
}
