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
      // Routing uses the ORS key (this is the real key test); place-search is
      // keyless via Nominatim now, so test that for availability only.
      let routing = "unreachable", body = "";
      try {
        const d = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
          method: "POST",
          headers: { Authorization: key, "Content-Type": "application/json" },
          body: JSON.stringify({ coordinates: [[8.681, 49.411], [8.687, 49.420]] }),
        });
        routing = d.ok ? "ok" : `HTTP ${d.status}`;
        if (!d.ok) { try { body = (await d.text()).replace(/\s+/g, " ").slice(0, 180); } catch (_) {} }
      } catch (_) {}

      let geocode = "unreachable";
      try {
        const g = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=orchard", {
          headers: { "User-Agent": "SecondSight/1.0 (assistive navigation)", "Accept-Language": "en" },
        });
        geocode = g.ok ? "ok" : `HTTP ${g.status}`;
      } catch (_) {}

      if (routing === "ok" && geocode === "ok") return "ok";
      return `routing ${routing}, geocode(nominatim) ${geocode}${body ? ` — ${body}` : ""}`;
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
