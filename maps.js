/* =========================================================================
   maps.js — Google Maps for blind-first WALKING navigation.

   The map is visual sugar for sighted helpers; the real output is the spoken,
   steppable turn-by-turn list. Uses the Maps JavaScript SDK (loaded with the
   user's key) so Places + Directions run client-side without CORS issues.
   ========================================================================= */

let mapsPromise = null;
let map = null;
let renderer = null;

// Load the Maps JS SDK once (Places library included). Resolves with
// `google.maps`. Rejects with a speakable message if the script can't load.
export function loadMapsApi(key) {
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve(window.google.maps);
    if (!key) return reject(new Error("Add your Google Maps key in Settings first."));

    const cb = "__secondSightMapsReady";
    window[cb] = () => resolve(window.google.maps);

    // Fires if the key is invalid / unauthorized.
    window.gm_authFailure = () =>
      reject(new Error("Your Google Maps key was rejected. Check it in Settings."));

    const s = document.createElement("script");
    s.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(key) +
      "&libraries=places&loading=async&callback=" + cb;
    s.async = true;
    s.onerror = () => {
      mapsPromise = null; // allow a retry after fixing the key/network
      reject(new Error("Couldn't load Google Maps. Check your connection and key."));
    };
    document.head.appendChild(s);
  });

  return mapsPromise;
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

// Create the map once (or recenter it) inside `el`.
export function getMap(google, el, center) {
  if (!map) {
    map = new google.maps.Map(el, {
      center,
      zoom: 15,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "greedy",
      keyboardShortcuts: false,
    });
    renderer = new google.maps.DirectionsRenderer({ map });
  } else {
    map.setCenter(center);
  }
  return map;
}

function stripHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}

// Resolve a free-text destination ("nearest pharmacy", an address, a place
// name) to a location, biased to the user's surroundings.
function findPlace(google, query, center) {
  return new Promise((resolve, reject) => {
    const svc = new google.maps.places.PlacesService(map);
    svc.textSearch({ query, location: center, radius: 8000 }, (results, status) => {
      const S = google.maps.places.PlacesServiceStatus;
      if (status === S.OK && results && results.length) {
        const r = results[0];
        resolve({
          name: r.name || query,
          address: r.formatted_address || "",
          location: r.geometry.location,
        });
      } else if (status === S.ZERO_RESULTS) {
        reject(new Error("I couldn't find that place. Try saying it differently."));
      } else if (status === S.REQUEST_DENIED) {
        reject(new Error("Your Google Maps key isn't authorized for Places. Check it in Settings."));
      } else {
        reject(new Error("Place search failed. Try again."));
      }
    });
  });
}

// Plan a WALKING route from origin coords to the spoken destination.
// Returns a speak-friendly summary + step list, plus the raw directions
// result for rendering on the map.
export async function planWalkingRoute(google, originCoords, query) {
  const center = new google.maps.LatLng(originCoords.lat, originCoords.lng);
  const place = await findPlace(google, query, center);

  const ds = new google.maps.DirectionsService();
  let dirs;
  try {
    dirs = await ds.route({
      origin: originCoords,
      destination: place.location,
      travelMode: google.maps.TravelMode.WALKING,
    });
  } catch (e) {
    const status = e && e.code ? e.code : "";
    if (status === "ZERO_RESULTS")
      throw new Error("I couldn't find a walking route to that place.");
    if (status === "REQUEST_DENIED")
      throw new Error("Your Google Maps key isn't authorized for Directions. Check it in Settings.");
    throw new Error("Couldn't get directions. Try again.");
  }

  const leg = dirs.routes[0].legs[0];
  const steps = leg.steps.map((s) => ({
    text: stripHtml(s.instructions),
    distance: s.distance ? s.distance.text : "",
  }));

  return {
    destinationName: place.name,
    address: place.address,
    distanceText: leg.distance ? leg.distance.text : "",
    durationText: leg.duration ? leg.duration.text : "",
    steps,
    dirs,
  };
}

export function renderRoute(dirs) {
  if (renderer) renderer.setDirections(dirs);
}
