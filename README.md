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
- API keys live **only on the server** as environment variables — never in the
  front end, never on the device, never in this repo. The browser only talks to
  our own `/api/*` endpoints.

## Two ways to run

The camera requires HTTPS, so you can't just open the file.

### A) Vercel — backend mode (keys in env, automated, + family tracking)

This is the path toward the IoT future: the **server holds the keys** (the
browser never sees them) and stores location for family sharing.

1. Import the repo into **Vercel** (it auto-detects the static site + the
   serverless functions in `/api`; no build step).
2. In **Project → Settings → Environment Variables**, add (see `.env.example`):
   `OPENAI_API_KEY` (required), `EXA_API_KEY` (optional), `ORS_API_KEY`
   (optional). For durable family tracking add a **Vercel KV** integration
   (sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`); without it, tracking still
   works in-memory for a quick demo.
3. Deploy. Open the Vercel URL on your phone → the app detects the backend and
   **needs no pasted keys**. Family opens `…/family` and enters the share code.

### B) GitHub Pages — on-device only (no keys anywhere)

Zero server. In the repo: **Settings → Pages → Deploy from a branch**, pick
this branch and `/ (root)`. Live at:

```
https://chodan121905.github.io/secondinsight/
```

There is no `/api` here and **the front end never holds keys**, so only the
**on-device** features work — **Enhance** (zoom/contrast/torch) and **Around
me** (object detection). The AI features (Describe / Read / Medicine /
Translate / Ask / Navigate) and family tracking all need the deployed backend.

> **Keys are never in the front end.** They live only as server environment
> variables and are reached through `/api/*`. On load the app pings
> `/api/health`; with a backend it enables the AI features, without one it
> says so. There is nothing to paste and nothing to switch by hand.

## Using it

1. Tap anywhere to start the camera.
2. **Enhance** (the 🔆 button) works immediately with **no key, no server** —
   zoom + contrast / brighter / black-and-white / invert + torch. The
   offline-safe fallback.
3. The AI features need the **deployed backend** (keys in env). No keys are ever
   entered in the app — if the backend is missing, those buttons say so.
4. Point the camera and tap **Describe**, **Read text**, **Medicine label**,
   **Translate sign**, or **Ask a question** — results are read aloud and shown
   as large captions. Tap **🔊 Replay** to hear a result again.
5. **🧭 Navigate somewhere:** say or type a destination ("nearest pharmacy",
   an address, a place name). The app finds your location and speaks the best
   **walking route**, then lets you step through each instruction (Next / Back
   / Repeat) as you walk. A map renders for sighted helpers.

   Navigation uses **free, no-billing** services: **OpenStreetMap** tiles via
   Leaflet (no key) for the map, and **OpenRouteService** (server-side, key in
   env) for search + walking directions.

6. **👣 Around me (walking awareness):** a hands-free, real-time loop that calls
   out nearby people, vehicles, and objects with rough position and proximity —
   "Person ahead, close", "Car on your left", "Bicycle on your right" — with an
   urgent tone + haptic when a hazard is very close. Toggle it on and walk;
   toggle off to stop. Live detection boxes render for sighted helpers.

   Runs on-device with **coco-ssd (MobileNet-SSD)** via TensorFlow.js — a
   **YOLO-style** object detector that needs **no API key, no cost**, and keeps
   working **offline** once loaded. It detects the 80 COCO classes (people,
   bicycles, cars, buses, trucks, motorcycles, dogs, traffic lights, stop
   signs, benches…) — common objects and people, *not* curbs/poles/stairs.
   `detect.js` is the only module tied to the model, so a real YOLOv8 ONNX model
   can be dropped in later without touching the walking UX.

7. **👪 Family location sharing (backend mode):** in **Settings**, set a name +
   a hard-to-guess share code and tick *Share my live location*. The device
   posts its GPS to the server; a family member opens **`/family`**, enters the
   same code, and watches the live position + recent trail on a map (auto-
   refreshing). Anyone with the code can view, so treat the code as a secret.

> **Camera is a prototype input.** `camera.js` is the only module bound to the
> video source, so the phone camera can later be swapped for an IoT / remote
> camera (stream into the same `<video>`) without touching the AI, speech,
> navigation, or UI code.

## Architecture & roadmap (toward a headless IoT device)

The app runs in **two modes from one codebase**:

- **Static mode** (`*.js` ES modules, no build): the browser calls OpenAI / Exa
  / OpenRouteService directly with keys the user pastes (memory only). Great as
  a zero-infra demo and an on-stage fallback.
- **Backend mode** (`/api/*` serverless functions on Vercel): keys live in
  **env vars**, the browser only talks to our own endpoints, and the server
  stores location for family sharing. The front-end auto-detects this via
  `/api/health`.

Backend mode is the bridge to the **headless future you described — "just a
camera, no front-end."** Because the API already accepts a frame and returns
speakable text (and a route, and detections later), an IoT camera can POST
frames to `/api/vision` (etc.) and play back the audio, with **no UI to paste
keys into** — there is no UI. The same `/api/location` powers family tracking
whether the client is a phone today or a wearable cam tomorrow.

| Concern | Module / endpoint | Swappable for IoT? |
| --- | --- | --- |
| Camera input | `camera.js` (`<video>` source) | ✅ feed a remote/IoT stream |
| Vision + reasoning | `/api/vision` (gpt-4o) | ✅ device POSTs frames |
| Object detection | `detect.js` (coco-ssd) | ✅ swap a YOLOv8 ONNX, or move server-side |
| Navigation | `/api/route` (ORS) | ✅ device POSTs origin + destination |
| Family tracking | `/api/location` (+ KV) | ✅ device POSTs GPS |
| Keys | server **env vars** | ✅ never on the device |

### Accessibility model

- **Self-voicing:** the app speaks to you (welcome, chosen action, results,
  errors) even with no screen reader running.
- **Screen-reader-native:** every control is a labelled button; focus is
  managed so VoiceOver / TalkBack announce the right thing.
- **Large-print visual:** Atkinson Hyperlegible, high-contrast dark theme,
  ≥72px tap targets, amber=action / cyan=listening, visible focus rings,
  reduced-motion respected.

### Built from a blind user's perspective

- **Explore by touch (works with NO screen reader):** slide a finger around the
  screen and the button under it is spoken aloud; lift to choose it. A quick tap
  still behaves normally, and mouse users never trigger it. This is how a blind
  user *chooses* anything when they aren't running VoiceOver/TalkBack — and when
  they are, the OS handles touch and this stays out of the way.
- **Tap the camera to Describe** — the camera is the biggest thing on screen,
  so it *is* the primary action; no hunting for a button.
- **Flashlight + low-light warning** — reading a label in dim light is a top
  failure mode, so the app warns "it looks dark" before a text read and offers
  a camera **torch** toggle (where the hardware supports it).
- **Adjustable speech speed** (Slow → Faster) — experienced screen-reader
  users listen fast; the default rate is theirs to change, with a live preview.
- **Earcons** — short distinct sounds confirm *capture / listening / done /
  error / arrived* instantly, before the slower spoken result, plus haptics.
