/* =========================================================================
   vision.js — the single capture→model loop, reused with different prompts,
   plus optional Exa enrichment for medicine labels.

   SAFETY: this is an accessibility tool a blind user may rely on, so every
   prompt forbids guessing. The model must report only what is clearly
   visible and explicitly flag anything blurry, cut off, or unreadable.
   ========================================================================= */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const EXA_URL    = "https://api.exa.ai/answer";
const MODEL      = "gpt-4o";

const SYSTEM = [
  "You are Second Sight, the eyes of a blind or low-vision user.",
  "You receive ONE photo from their phone camera.",
  "Rules you must always follow:",
  "- Describe ONLY what is clearly visible. Never guess, infer, or invent.",
  "- If the image is blurry, dark, glare-washed, cut off, or text is",
  "  unreadable, say so plainly instead of guessing.",
  "- Do not identify or name specific real people; describe them generically",
  "  (e.g. 'a person in a red coat').",
  "- Be concise and concrete. Lead with the single most useful fact.",
  "- Write short, plain sentences meant to be read aloud. No markdown,",
  "  no bullet symbols, no emojis.",
].join("\n");

// Per-task config: prompt, how much image detail the model should use, and how
// large a frame to capture (small print needs more pixels).
export const TASKS = {
  describe: {
    title: "Describing the scene",
    detail: "auto",
    maxDim: 1280,
    prompt:
      "Describe the scene in 2 to 4 short sentences for someone who cannot " +
      "see it. Cover the main subject, notable objects, any people and what " +
      "they appear to be doing, the setting, and anything that could be a " +
      "hazard (steps, traffic, obstacles). If the main subject is cut off or " +
      "the shot is too dark or blurry to read, say that first.",
  },
  read: {
    title: "Reading the text",
    detail: "high",
    maxDim: 1600,
    prompt:
      "Read aloud all clearly legible text in this image, in natural reading " +
      "order. Output only the text itself, grouped sensibly. If part of the " +
      "text is too small, blurry, or cut off to read, say which part is " +
      "unclear rather than guessing. If there is no readable text, say so.",
  },
  medicine: {
    title: "Reading the medicine label",
    detail: "high",
    maxDim: 1600,
    prompt:
      "This is a medicine label. Read only what is clearly printed — never " +
      "guess any name, number, dose, or instruction. State, each on its own " +
      "short line:\n" +
      "Name: <medication name>\n" +
      "Strength: <dose/strength>\n" +
      "Form: <tablet/liquid/etc.>\n" +
      "Directions: <how and how often to take it>\n" +
      "Warnings: <any cautions printed on the label>\n" +
      "If any field is missing, not visible, or unreadable, write 'not " +
      "clearly visible' for that field. Finish with this exact sentence: " +
      "'Always confirm medication details with your pharmacist or doctor.'",
  },
  translate: {
    title: "Translating the sign",
    detail: "high",
    maxDim: 1600,
    prompt:
      "This image shows a sign or written text that may not be in English. " +
      "First name the source language if you can tell. Then give a clear " +
      "English translation of the text that is clearly legible. Translate " +
      "only what you can actually read; note anything too unclear to read. " +
      "If the text is already English, simply read it aloud.",
  },
  ask: {
    title: "Answering your question",
    detail: "high",
    maxDim: 1600,
    // The user's question is appended at call time.
    prompt:
      "Answer the user's question using ONLY what is clearly visible in the " +
      "image. If the image doesn't show enough to answer confidently, say so " +
      "plainly instead of guessing. Keep it short and spoken-friendly.\n\n" +
      "Question: ",
  },
};

export function taskTitle(task) {
  return (TASKS[task] && TASKS[task].title) || "Result";
}

// Turn fetch/HTTP failures into plain-language, speakable messages.
function describeError(status, fallback) {
  switch (status) {
    case 401: return "Your OpenAI key was rejected. Check it in Settings.";
    case 429: return "The OpenAI service is rate-limited or out of quota right now. Wait a moment and try again.";
    case 400: return "The image could not be processed. Try taking the photo again.";
    case 500: case 502: case 503: case 504:
      return "The OpenAI service is temporarily unavailable. Try again shortly.";
    default:  return fallback || "Something went wrong contacting the AI service.";
  }
}

export async function analyzeImage({ task, question, imageDataUrl, apiKey, signal }) {
  const cfg = TASKS[task] || TASKS.describe;
  const userText = task === "ask" ? cfg.prompt + (question || "").trim() : cfg.prompt;

  const body = {
    model: MODEL,
    temperature: 0.2, // low: we want faithful reading, not creativity
    max_tokens: 500,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: imageDataUrl, detail: cfg.detail } },
        ],
      },
    ],
  };

  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (_) {
    throw new Error("No network connection. Check your internet and try again.");
  }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch (_) {}
    throw new Error(describeError(res.status, detail));
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The AI service returned an empty answer. Try again.");
  return text;
}

// Non-blocking enrichment: after a label is read, ask Exa what the drug treats
// and its key warning. Must NEVER break the core read — caller fires & forgets.
export async function exaEnrich({ labelText, apiKey, signal }) {
  if (!apiKey) return null;
  const query =
    "Based on this medicine label text, in two short sentences: what is this " +
    "medication commonly used to treat, and what is its single most important " +
    "safety warning? If unsure, say so.\n\nLabel text:\n" + labelText;

  let res;
  try {
    res = await fetch(EXA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query, text: true }),
      signal,
    });
  } catch (_) {
    return null; // network/CORS — silently skip, core read already spoken
  }
  if (!res.ok) return null;

  try {
    const data = await res.json();
    const answer = (data?.answer || "").trim();
    return answer || null;
  } catch (_) {
    return null;
  }
}
