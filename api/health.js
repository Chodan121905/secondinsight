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
      const key = (process.env.ORS_API_KEY || "").trim();
      // Test geocoding (query-param auth) and routing (header auth) separately
      // — they authenticate differently, so this shows if only one is failing.
      const g = await fetch(
        `https://api.openrouteservice.org/geocode/search?api_key=${encodeURIComponent(key)}&text=test&size=1`);
      let geocode = g.ok ? "ok" : `HTTP ${g.status}`;
      let body = "";
      if (!g.ok) { try { body = (await g.text()).replace(/\s+/g, " ").slice(0, 180); } catch (_) {} }

      let routing;
      try {
        const d = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
          method: "POST",
          headers: { Authorization: key, "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: [[8.681, 49.411], [8.687, 49.420]] }),
        });
        routing = d.ok ? "ok" : `HTTP ${d.status}`;
      } catch (_) { routing = "unreachable"; }

      if (geocode === "ok" && routing === "ok") return "ok";
      return `geocode ${geocode}, routing ${routing}${body ? ` — ${body}` : ""}`;
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
