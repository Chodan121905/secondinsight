/* family.js — poll /api/location for a code and show it on a map.
   Sighted-audience page (family member), so it's map-first with clear text. */

(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const codeInput = $("code");
  const watchBtn = $("watch");
  const statusEl = $("famStatus");
  const mapEl = $("famMap");

  let map = null, marker = null, trail = null, timer = null;

  // Prefill code from ?code= so a family member can be sent a direct link.
  const fromUrl = new URLSearchParams(location.search).get("code");
  if (fromUrl) codeInput.value = fromUrl;

  function setStatus(text) { statusEl.textContent = text; }

  function ensureMap(lat, lng) {
    if (!window.L) { setStatus("Map library failed to load. Check your connection."); return null; }
    if (!map) {
      map = L.map(mapEl, { zoomControl: true }).setView([lat, lng], 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "© OpenStreetMap contributors",
      }).addTo(map);
    }
    return map;
  }

  function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s} second${s === 1 ? "" : "s"} ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
    const h = Math.round(m / 60);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }

  function render(data) {
    if (!data || !data.latest) { setStatus("No location yet for this code."); return; }
    const { lat, lng, name, ts } = data.latest;
    const m = ensureMap(lat, lng);
    if (!m) return;

    const trailPts = (data.trail || []).map((p) => [p.lat, p.lng]);
    if (trail) trail.remove();
    if (trailPts.length > 1) trail = L.polyline(trailPts, { color: "#2ee6e6", weight: 5, opacity: 0.8 }).addTo(m);

    if (!marker) marker = L.marker([lat, lng]).addTo(m);
    else marker.setLatLng([lat, lng]);
    marker.bindPopup((name ? name + " — " : "") + "here").openPopup();
    m.setView([lat, lng], m.getZoom() < 14 ? 16 : m.getZoom());

    setStatus(`${name ? name + " was" : "Last seen"} here ${ago(ts)}. Updating every 5 seconds.`);
  }

  async function poll(code) {
    try {
      const r = await fetch(`/api/location?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      if (!r.ok) { setStatus("Couldn't reach the server. Is this page running on the deployed app?"); return; }
      render(await r.json());
    } catch (_) {
      setStatus("Couldn't reach the server. Check your connection.");
    }
  }

  function start() {
    const code = codeInput.value.trim();
    if (!code) { setStatus("Enter a share code first."); codeInput.focus(); return; }
    if (timer) clearInterval(timer);
    setStatus("Looking for the latest location…");
    poll(code);
    timer = setInterval(() => poll(code), 5000);
  }

  watchBtn.addEventListener("click", start);
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
  if (fromUrl) start();
})();
