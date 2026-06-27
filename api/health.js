/* GET /api/health — lets the front-end discover the backend and which
   features the server provides keys for (so the UI can skip asking).

   The default response only reports whether each key is PRESENT (cheap, runs on
   every app load). Add ?check=1 to also live-validate the keys against the
   providers — a manual debugging aid so you can tell "key present" from "key
   actually works" (e.g. an ORS key that's rejected). Don't call ?check on every
   load; it spends real quota. */
module.exports = async (req, res) => {
  if (cors(req, res)) return;

  const present = {
    vision: !!process.env.OPENAI_API_KEY,
    exa: !!process.env.EXA_API_KEY,
    maps: !!process.env.ORS_API_KEY,
    tracking: true,
  };

  const url = new URL(req.url, "http://x");
  if (!url.searchParams.has("check")) {
    return res.status(200).json({ ok: true, features: present });
  }

  // Live validation (manual): hit each provider with a tiny request.
  const checks = {};
  await Promise.all([
    validate("vision", present.vision, async () => {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${(process.env.OPENAI_API_KEY || "").trim()}` },
      });
      return r.ok ? "ok" : `rejected (HTTP ${r.status})`;
    }, checks),
    validate("maps", present.maps, async () => {
      const k = encodeURIComponent((process.env.ORS_API_KEY || "").trim());
      const r = await fetch(`https://api.openrouteservice.org/geocode/search?api_key=${k}&text=test&size=1`);
      return r.ok ? "ok" : `rejected (HTTP ${r.status})`;
    }, checks),
    validate("exa", present.exa, async () => {
      const r = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": (process.env.EXA_API_KEY || "").trim() },
        body: JSON.stringify({ query: "test", numResults: 1 }),
      });
      return r.ok ? "ok" : `rejected (HTTP ${r.status})`;
    }, checks),
  ]);

  res.status(200).json({ ok: true, features: present, checks });
};

async function validate(name, isPresent, fn, out) {
  if (!isPresent) { out[name] = "no key set"; return; }
  try { out[name] = await fn(); } catch (_) { out[name] = "couldn't reach provider"; }
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}
