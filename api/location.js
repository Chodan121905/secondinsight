/* /api/location — family location sharing.
     POST { code, name, lat, lng }  → the walker's device updates its position
     GET  ?code=CODE                → family fetches { latest, trail }

   Storage: uses Vercel KV / Upstash Redis (via REST) when its env vars are
   present (durable across instances); otherwise falls back to in-memory, which
   is fine for a quick same-instance demo. Anyone with the code can read the
   location — it's a shared secret, so use an unguessable code. */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const TRAIL_MAX = 50;

const mem = global.__ssLoc || (global.__ssLoc = new Map());

module.exports = async (req, res) => {
  if (cors(req, res)) return;

  if (req.method === "POST") {
    const { code, name, lat, lng } = readBody(req);
    if (!code || typeof lat !== "number" || typeof lng !== "number")
      return res.status(400).json({ error: "code, lat and lng are required." });
    const rec = await getRec(code);
    const point = { lat, lng, name: (name || "").slice(0, 40), ts: Date.now() };
    rec.latest = point;
    rec.trail.push(point);
    if (rec.trail.length > TRAIL_MAX) rec.trail = rec.trail.slice(-TRAIL_MAX);
    await setRec(code, rec);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "GET") {
    const code = (req.query && req.query.code) || "";
    if (!code) return res.status(400).json({ error: "code is required." });
    return res.status(200).json(await getRec(code));
  }

  return res.status(405).json({ error: "GET or POST only." });
};

async function getRec(code) {
  if (KV_URL) {
    const v = await kvGet("ssloc:" + code);
    return v || { latest: null, trail: [] };
  }
  return mem.get(code) || { latest: null, trail: [] };
}
async function setRec(code, rec) {
  if (KV_URL) return kvSet("ssloc:" + code, rec);
  mem.set(code, rec);
}
async function kvGet(key) {
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOK}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.result ? JSON.parse(j.result) : null;
  } catch (_) { return null; }
}
async function kvSet(key, val) {
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "text/plain" },
      body: JSON.stringify(val),
    });
  } catch (_) {}
}
function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (_) { return {}; }
}
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}
