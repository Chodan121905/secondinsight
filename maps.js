/* =========================================================================
   maps.js — blind-first WALKING navigation on FREE, no-billing services:
     • Map tiles:   OpenStreetMap via Leaflet  (no key)
     • Search:      OpenRouteService geocoder   (free key, no credit card)
     • Routing:     OpenRouteService foot-walking (free key)

   The map is visual sugar for sighted helpers; the spoken, steppable
   turn-by-turn list is the real output.
   ========================================================================= */

const ORS = "https://api.openrouteservice.org";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

let leafletPromise = null;
let map = null;
let routeLayer = null;
let markers = [];

// Load Leaflet (map library + CSS) once. No API key needed for the map.
export function loadMap() {
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);

    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      css.setAttribute("data-leaflet", "");
      document.head.appendChild(css);
    }
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = () => {
      leafletPromise = null;
      reject(new Error("Couldn't load the map. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return leafletPromise;
}

// Current location → {lat,lng}. Plain-language errors for permission/timeout.
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(new Error("This device can't share its location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => {
        const msg =
          err.code === 1
            ? "Location permission was blocked. Allow location access and try again."
            : err.code === 3
            ? "Getting your location timed out. Try again with a clearer view of the sky."
            : "Couldn't get your location. Try again.";
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

// Create the map once (or recenter). `el` must be visible so tiles size right.
export function getMap(L, el, center) {
  if (!map) {
    map = L.map(el, { zoomControl: true, attributionControl: true })
           .setView([center.lat, center.lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
  } else {
    map.setView([center.lat, center.lng], 15);
  }
  // Leaflet miscalculates size if the container was hidden when created.
  setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 120);
  return map;
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} metres` : `${(m / 1000).toFixed(1)} kilometres`;
}
function fmtDur(s) {
  const min = Math.max(1, Math.round(s / 60));
  return `${min} minute${min === 1 ? "" : "s"}`;
}
function orsError(status, kind) {
  if (status === 401 || status === 403)
    return "Your OpenRouteService key was rejected. Check it in Settings.";
  if (status === 429)
    return "The free map service is rate-limited right now. Wait a moment and try again.";
  return kind === "search" ? "Place search failed. Try again." : "Couldn't get directions. Try again.";
}

// Resolve a spoken destination to a place, biased to the user's surroundings.
async function geocode(key, query, center) {
  const url =
    `${ORS}/geocode/search?api_key=${encodeURIComponent(key)}` +
    `&text=${encodeURIComponent(query)}&size=1` +
    `&focus.point.lon=${center.lng}&focus.point.lat=${center.lat}`;

  let res;
  try { res = await fetch(url); }
  catch (_) { throw new Error("No network connection. Check your internet and try again."); }
  if (!res.ok) throw new Error(orsError(res.status, "search"));

  const data = await res.json();
  const f = data.features && data.features[0];
  if (!f) throw new Error("I couldn't find that place. Try saying it differently.");
  return {
    name: f.properties.name || f.properties.label || query,
    label: f.properties.label || "",
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  };
}

// Walking route from origin to a destination place.
async function route(key, origin, dest) {
  let res;
  try {
    res = await fetch(`${ORS}/v2/directions/foot-walking/geojson`, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: [[origin.lng, origin.lat], [dest.lon, dest.lat]],
        instructions: true,
        units: "m",
        language: "en",
      }),
    });
  } catch (_) {
    throw new Error("No network connection. Check your internet and try again.");
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error("I couldn't find a walking route to that place.");
    throw new Error(orsError(res.status, "route"));
  }

  const data = await res.json();
  const feat = data.features && data.features[0];
  if (!feat) throw new Error("I couldn't find a walking route to that place.");
  const seg = feat.properties.segments[0];
  const steps = seg.steps.map((s) => ({
    text: s.instruction,
    distance: s.distance ? fmtDist(s.distance) : "",
  }));
  const coords = feat.geometry.coordinates.map((c) => [c[1], c[0]]); // [lat,lon]
  return { steps, coords, distanceText: fmtDist(seg.distance), durationText: fmtDur(seg.duration) };
}

export async function planWalkingRoute(key, originCoords, query) {
  if (!key) throw new Error("Add your free OpenRouteService key in Settings first.");
  const dest = await geocode(key, query, originCoords);
  const r = await route(key, originCoords, dest);
  return {
    destinationName: dest.name,
    address: dest.label,
    distanceText: r.distanceText,
    durationText: r.durationText,
    steps: r.steps,
    coords: r.coords,
    dest,
  };
}

// Draw the route line + start/end markers and fit the map to it.
export function renderRoute(L, mapObj, coords, origin, dest) {
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  markers.forEach((m) => m.remove());
  markers = [];

  routeLayer = L.polyline(coords, { color: "#ffb300", weight: 6, opacity: 0.95 }).addTo(mapObj);
  markers.push(L.marker([origin.lat, origin.lng]).addTo(mapObj).bindPopup("You are here"));
  markers.push(L.marker([dest.lat, dest.lon]).addTo(mapObj).bindPopup(dest.name));
  try { mapObj.fitBounds(routeLayer.getBounds(), { padding: [30, 30] }); } catch (_) {}
}
