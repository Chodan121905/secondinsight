/* =========================================================================
   backend.js — optional server adapter.

   When the app is served by the Vercel deployment, these /api endpoints exist
   and hold the keys in env, so the UI needs no pasted keys. When served as a
   plain static site (e.g. GitHub Pages), the health check fails and the app
   falls back to user-pasted keys. One codebase, two modes.
   ========================================================================= */

const BASE = "/api";
let caps = { vision: false, exa: false, maps: false, tracking: false, _up: false };
let healthPromise = null;

export function initBackend() {
  if (!healthPromise) {
    healthPromise = fetch(`${BASE}/health`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && j.ok) caps = { ...caps, ...j.features, _up: true };
        return caps;
      })
      .catch(() => caps);
  }
  return healthPromise;
}

export const backendHas = (feature) => !!caps[feature];
export const backendUp = () => caps._up;

export async function visionViaServer({ task, question, imageDataUrl, signal }) {
  const r = await fetch(`${BASE}/vision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, question, image: imageDataUrl }),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "The AI service had a problem. Try again.");
  return j.text;
}

// Ask the server (OpenAI key in env) to interpret a spoken command. Returns
// { action, destination, question } or null if the server can't help, so the
// caller can fall back to local keyword matching.
export async function intentViaServer({ text, signal }) {
  try {
    const r = await fetch(`${BASE}/intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

export async function exaViaServer({ labelText, signal }) {
  try {
    const r = await fetch(`${BASE}/exa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelText }),
      signal,
    });
    if (!r.ok) return null;
    return (await r.json()).answer || null;
  } catch (_) { return null; }
}

export async function routeViaServer({ origin, query, signal }) {
  const r = await fetch(`${BASE}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, query }),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Couldn't get directions. Try again.");
  return j;
}

export async function postLocation({ code, name, lat, lng }) {
  try {
    await fetch(`${BASE}/location`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, lat, lng }),
    });
  } catch (_) { /* best-effort */ }
}
