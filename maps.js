/* =========================================================================
   maps.js — CLIENT map DISPLAY only (OpenStreetMap via Leaflet, no key).

   Geocoding + walking-route planning are done on the SERVER (/api/route) so no
   maps key is ever in the front end. This module just loads Leaflet, reads the
   device location, and draws the route the server returns. The map is visual
   sugar for sighted helpers; the spoken, steppable steps are the real output.
   ========================================================================= */

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

// Draw the route line + start/end markers and fit the map to it. `coords`,
// `origin` and `dest` come from the server's /api/route response.
export function renderRoute(L, mapObj, coords, origin, dest) {
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  markers.forEach((m) => m.remove());
  markers = [];

  routeLayer = L.polyline(coords, { color: "#ffb300", weight: 6, opacity: 0.95 }).addTo(mapObj);
  markers.push(L.marker([origin.lat, origin.lng]).addTo(mapObj).bindPopup("You are here"));
  markers.push(L.marker([dest.lat, dest.lon]).addTo(mapObj).bindPopup(dest.name));
  try { mapObj.fitBounds(routeLayer.getBounds(), { padding: [30, 30] }); } catch (_) {}
}
