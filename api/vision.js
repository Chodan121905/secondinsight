/* POST /api/vision  { task, question, image }  → { text }
   Server-side proxy to OpenAI gpt-4o. The key lives in env (OPENAI_API_KEY),
   never in the browser. Prompts (and their no-fabrication safety rules) live
   here so the server is the source of truth in backend mode. */

const SYSTEM = [
  "You are Second Sight, the eyes of a blind or low-vision user.",
  "You receive ONE photo from their phone camera.",
  "Rules you must always follow:",
  "- Describe ONLY what is clearly visible. Never guess, infer, or invent.",
  "- If the image is blurry, dark, glare-washed, cut off, or text is",
  "  unreadable, say so plainly instead of guessing.",
  "- Do not identify or name specific real people; describe them generically.",
  "- Be concise and concrete. Lead with the single most useful fact.",
  "- Write short, plain sentences meant to be read aloud. No markdown, no",
  "  bullet symbols, no emojis.",
].join("\n");

const TASKS = {
  describe: { detail: "auto", prompt:
    "Describe the scene in 2 to 4 short sentences for someone who cannot see " +
    "it. Cover the main subject, notable objects, any people and what they " +
    "appear to be doing, the setting, and anything that could be a hazard. If " +
    "the main subject is cut off or the shot is too dark or blurry to read, " +
    "say that first." },
  read: { detail: "high", prompt:
    "Read aloud all clearly legible text in this image, in natural reading " +
    "order. Output only the text itself, grouped sensibly. If part of the " +
    "text is too small, blurry, or cut off to read, say which part is unclear " +
    "rather than guessing. If there is no readable text, say so." },
  medicine: { detail: "high", prompt:
    "This is a medicine label. Read only what is clearly printed — never guess " +
    "any name, number, dose, or instruction. State, each on its own short " +
    "line:\nName: <medication name>\nStrength: <dose/strength>\nForm: " +
    "<tablet/liquid/etc.>\nDirections: <how and how often to take it>\n" +
    "Warnings: <any cautions printed on the label>\nIf any field is missing, " +
    "not visible, or unreadable, write 'not clearly visible' for that field. " +
    "Finish with this exact sentence: 'Always confirm medication details with " +
    "your pharmacist or doctor.'" },
  translate: { detail: "high", prompt:
    "This image shows a sign or written text that may not be in English. First " +
    "name the source language if you can tell. Then give a clear English " +
    "translation of the text that is clearly legible. Translate only what you " +
    "can actually read; note anything too unclear. If it's already English, " +
    "simply read it aloud." },
  ask: { detail: "high", prompt:
    "Answer the user's question using ONLY what is clearly visible in the " +
    "image. If the image doesn't show enough to answer confidently, say so " +
    "plainly instead of guessing. Keep it short and spoken-friendly.\n\n" +
    "Question: " },
};

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: "The server has no OpenAI key configured." });

  const body = readBody(req);
  const { task, question, image } = body;
  if (!image) return res.status(400).json({ error: "No image was provided." });

  const cfg = TASKS[task] || TASKS.describe;
  const userText = task === "ask" ? cfg.prompt + (question || "").trim() : cfg.prompt;

  let r;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: image, detail: cfg.detail } },
          ] },
        ],
      }),
    });
  } catch (_) {
    return res.status(502).json({ error: "The AI service couldn't be reached. Try again." });
  }

  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json())?.error?.message || ""; } catch (_) {}
    return res.status(502).json({ error: mapErr(r.status, detail) });
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) return res.status(502).json({ error: "The AI returned an empty answer. Try again." });
  res.status(200).json({ text });
};

function mapErr(status, detail) {
  if (status === 401) return "The server's OpenAI key was rejected.";
  if (status === 429) return "The AI service is rate-limited or out of quota. Wait a moment and try again.";
  if (status === 400) return "The image could not be processed. Try taking the photo again.";
  return detail || "The AI service had a problem. Try again.";
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
