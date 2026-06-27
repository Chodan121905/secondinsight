# Second Sight

A mobile-first web app that acts as a spare pair of eyes for blind and
low-vision users. Point your phone's camera at the world and Second Sight can
**enhance** the view, **describe** a scene, **read** text and medicine labels,
**translate** signs, and **answer** spoken questions — out loud.

> Built as a hackathon demo. Designed *for* low-vision users, so the UI itself
> demonstrates the principles: Atkinson Hyperlegible type, high-contrast dark
> theme, huge tap targets, and voice-first interaction.

## Two engines, five features

1. **Enhance** — pure front-end (no network): live camera with zoom + contrast
   / brightness / black-and-white / invert filters. The safety net that works
   even with no wifi or API key.
2. **Capture → vision model → speak** — one loop, reused for: describe the
   scene, read text, read a medicine label (with a "confirm with a pharmacist"
   disclaimer), translate a sign to English, and answer a free-form question.

## Stack

- Static single-page app — **no build step** (plain HTML/CSS/JS) for maximum
  reliability and live-debuggability. Served over HTTPS (required for camera
  and microphone access).
- Vision + reasoning: **OpenAI gpt-4o** (Chat Completions, base64 JPEG frame).
- Speech out: browser **SpeechSynthesis**. Speech in: **SpeechRecognition**
  with a typed-text fallback (voice input is flaky on iOS Safari).
- Optional enrichment: **Exa /answer** for extra context on medicine labels.
- API keys are pasted into a settings panel and held **in memory only** for the
  session — never persisted, never hardcoded.

## Run / test on a phone

The camera requires HTTPS, so you can't just open the file. Use one of:

**GitHub Pages (zero tokens):** in the repo, go to **Settings → Pages →
Build and deployment → Source: Deploy from a branch**, pick this branch and the
`/ (root)` folder, Save. After ~1 minute the app is live at:

```
https://chodan121905.github.io/secondinsight/
```

Open that on your phone and tap **Start camera**.

**Local over your network (HTTPS):** any static server with a TLS cert on the
same wifi also works; plain `http://` will be blocked by the browser for camera
access (except on `localhost`).

## Using it

1. Tap anywhere to start the camera.
2. **Enhance** (the 🔆 button) works immediately with **no key** — zoom +
   contrast / brighter / black-and-white / invert. This is the offline-safe
   fallback.
3. For the AI features, open **⚙️ Settings** and paste your **OpenAI API key**
   (and optionally an **Exa** key for medicine info). Keys live in memory only.
4. Point the camera and tap **Describe**, **Read text**, **Medicine label**,
   **Translate sign**, or **Ask a question** — results are read aloud and shown
   as large captions. Tap **🔊 Replay** to hear a result again.
5. **🧭 Navigate somewhere:** say or type a destination ("nearest pharmacy",
   an address, a place name). The app finds your location and speaks the best
   **walking route**, then lets you step through each instruction (Next / Back
   / Repeat) as you walk. A map renders for sighted helpers.

   Navigation uses **free, no-billing** services: **OpenStreetMap** tiles via
   Leaflet (no key) for the map, and **OpenRouteService** for search + walking
   directions. Get a free ORS key (no credit card) at
   <https://openrouteservice.org/dev/#/signup>, paste it into **Settings**, and
   allow location permission.

> **Camera is a prototype input.** `camera.js` is the only module bound to the
> video source, so the phone camera can later be swapped for an IoT / remote
> camera (stream into the same `<video>`) without touching the AI, speech,
> navigation, or UI code.

### Accessibility model

- **Self-voicing:** the app speaks to you (welcome, chosen action, results,
  errors) even with no screen reader running.
- **Screen-reader-native:** every control is a labelled button; focus is
  managed so VoiceOver / TalkBack announce the right thing.
- **Large-print visual:** Atkinson Hyperlegible, high-contrast dark theme,
  ≥72px tap targets, amber=action / cyan=listening, visible focus rings,
  reduced-motion respected.

### Built from a blind user's perspective

- **Tap the camera to Describe** — the camera is the biggest thing on screen,
  so it *is* the primary action; no hunting for a button.
- **Flashlight + low-light warning** — reading a label in dim light is a top
  failure mode, so the app warns "it looks dark" before a text read and offers
  a camera **torch** toggle (where the hardware supports it).
- **Adjustable speech speed** (Slow → Faster) — experienced screen-reader
  users listen fast; the default rate is theirs to change, with a live preview.
- **Earcons** — short distinct sounds confirm *capture / listening / done /
  error / arrived* instantly, before the slower spoken result, plus haptics.
