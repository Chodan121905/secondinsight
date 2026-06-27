/* POST /api/route  { origin:{lat,lng}, query }  → walking route
   Geocodes the destination then plans a foot-walking route, both via
   OpenRouteService (key from env ORS_API_KEY). Returns the same shape the
   client's maps.js produces, so the UI is identical in either mode. */

const ORS = "https://api.openrouteservice.org";

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });

  // Sanitize: pasting a key into a dashboard often leaves a trailing
  // newline/space or wrapping quotes, which makes ORS reject an otherwise-valid
  // key ("Access to this API has been disallowed").
  const key = (process.env.ORS_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!key) return res.status(500).json({ error: "The server has no maps key configured." });

  const { origin, query } = readBody(req);
  if (!origin || typeof origin.lat !== "number" || typeof origin.lng !== "number")
    return res.status(400).json({ error: "Missing your location." });
  if (!query) return res.status(400).json({ error: "Missing a destination." });

  try {
    // 1) Geocode the destination with OpenStreetMap Nominatim — free, no key,
    //    and reliable (ORS's hosted geocoding rejects many keys with 403). We
    //    bias results to a box around the user so "orchard" prefers the one
    //    near them. Nominatim requires a descriptive User-Agent.
    const d = 0.7; // ~bias box (degrees) around the user
    const viewbox = `${origin.lng - d},${origin.lat + d},${origin.lng + d},${origin.lat - d}`;
    const gUrl =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0` +
      `&q=${encodeURIComponent(query)}` +
      `&viewbox=${encodeURIComponent(viewbox)}&bounded=0`;
    const gRes = await fetch(gUrl, {
      headers: {
        "User-Agent": "SecondSight/1.0 (assistive navigation for low-vision users)",
        "Accept-Language": "en",
      },
    });
    if (!gRes.ok) return res.status(502).json({ error: "Place search failed. Try again in a moment." });
    const gData = await gRes.json();
    const place = Array.isArray(gData) && gData[0];
    if (!place) return res.status(404).json({ error: "I couldn't find that place. Try saying it differently." });
    const dest = {
      name: (place.name || (place.display_name || query).split(",")[0]).trim(),
      label: place.display_name || "",
      lon: parseFloat(place.lon),
      lat: parseFloat(place.lat),
    };

    // 2) Walking route.
    const dRes = await fetch(`${ORS}/v2/directions/foot-walking/geojson`, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: [[origin.lng, origin.lat], [dest.lon, dest.lat]],
        instructions: true, units: "m", language: "en",
      }),
    });
    if (!dRes.ok) {
      if (dRes.status === 404) return res.status(404).json({ error: "I couldn't find a walking route to that place." });
      return res.status(502).json({ error: await orsMessage(dRes, "route") });
    }
    const dData = await dRes.json();
    const feat = dData.features && dData.features[0];
    if (!feat) return res.status(404).json({ error: "I couldn't find a walking route to that place." });
    const seg = feat.properties.segments[0];

    res.status(200).json({
      destinationName: dest.name,
      address: dest.label,
      distanceText: fmtDist(seg.distance),
      durationText: fmtDur(seg.duration),
      steps: seg.steps.map((s) => ({ text: s.instruction, distance: s.distance ? fmtDist(s.distance) : "" })),
      coords: feat.geometry.coordinates.map((c) => [c[1], c[0]]),
      dest: { lat: dest.lat, lon: dest.lon },
    });
  } catch (_) {
    res.status(502).json({ error: "The maps service couldn't be reached. Try again." });
  }
};

function fmtDist(m) { return m < 1000 ? `${Math.round(m)} metres` : `${(m / 1000).toFixed(1)} kilometres`; }
function fmtDur(s) { const min = Math.max(1, Math.round(s / 60)); return `${min} minute${min === 1 ? "" : "s"}`; }
// Build a spoken-friendly message from the real ORS response, so a rejected
// key is distinguishable from a quota limit (both arrive as 401/403).
async function orsMessage(res, kind) {
  let detail = "";
  try {
    const data = await res.clone().json();
    detail = (data && (data.error?.message || data.error)) || "";
    if (typeof detail !== "string") detail = JSON.stringify(detail);
  } catch (_) {
    try { detail = await res.text(); } catch (_) {}
  }
  if (res.status === 401 || res.status === 403) {
    if (/quota|rate.?limit|daily|exceeded/i.test(detail))
      return "The maps service has hit its usage limit for now. Try again later.";
    return "The server's maps key was rejected. Check the ORS_API_KEY value in the server settings.";
  }
  if (res.status === 429) return "The maps service is rate-limited. Wait a moment and try again.";
  const base = kind === "search" ? "Place search failed." : "Couldn't get directions.";
  return detail ? `${base} (${detail.slice(0, 120)})` : `${base} Try again.`;
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
