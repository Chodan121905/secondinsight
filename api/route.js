/* POST /api/route  { origin:{lat,lng}, query }  → walking route
   Geocodes the destination then plans a foot-walking route, both via
   OpenRouteService (key from env ORS_API_KEY). Returns the same shape the
   client's maps.js produces, so the UI is identical in either mode. */

const ORS = "https://api.openrouteservice.org";

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });

  // Trim: pasting a key into a dashboard often leaves a trailing newline/space,
  // which makes ORS reject an otherwise-valid key.
  const key = (process.env.ORS_API_KEY || "").trim();
  if (!key) return res.status(500).json({ error: "The server has no maps key configured." });

  const { origin, query } = readBody(req);
  if (!origin || typeof origin.lat !== "number" || typeof origin.lng !== "number")
    return res.status(400).json({ error: "Missing your location." });
  if (!query) return res.status(400).json({ error: "Missing a destination." });

  try {
    // 1) Geocode the destination, biased to the user's location.
    const gUrl =
      `${ORS}/geocode/search?api_key=${encodeURIComponent(key)}` +
      `&text=${encodeURIComponent(query)}&size=1` +
      `&focus.point.lon=${origin.lng}&focus.point.lat=${origin.lat}`;
    const gRes = await fetch(gUrl);
    if (!gRes.ok) return res.status(502).json({ error: await orsMessage(gRes, "search") });
    const gData = await gRes.json();
    const f = gData.features && gData.features[0];
    if (!f) return res.status(404).json({ error: "I couldn't find that place. Try saying it differently." });
    const dest = {
      name: f.properties.name || f.properties.label || query,
      label: f.properties.label || "",
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
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
