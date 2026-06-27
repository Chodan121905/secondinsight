/* POST /api/intent  { text }  → { action, destination, question }
   Uses the OpenAI key (env) to understand a spoken command in ANY phrasing, so
   routing is smarter than keyword matching ("I wanna head down to orchard",
   "what's this thing in my hand", "it's too dark in here"). Cheap + fast:
   gpt-4o-mini with JSON output. The key never leaves the server. */

const SYSTEM = [
  "You turn ONE short spoken phrase from a blind user of an assistive camera",
  "app into a single structured action. Reply with ONLY a compact JSON object,",
  "no prose, no code fences.",
  "",
  "Allowed \"action\" values:",
  '- "navigate": they want directions or to go somewhere. Put the place in',
  '  "destination", cleaned up (e.g. "Orchard Road", "the nearest pharmacy").',
  '- "read": read text / a document / a sign in front of them.',
  '- "medicine": read a medicine or medication label.',
  '- "translate": translate text or a sign into English.',
  '- "describe": describe what is in front of them right now.',
  '- "around": what people or objects are around them.',
  '- "torch": turn on a light or flashlight (e.g. they say it is dark).',
  '- "repeat": say the last thing again.',
  '- "stop": be quiet / pause.',
  '- "start": resume / carry on.',
  '- "help": what can they say or do.',
  '- "ask": any other question about what the camera sees; put the cleaned',
  '  question in "question".',
  "",
  'When unsure, use "ask". Always include the relevant field.',
  'Examples:',
  'Input: "i wanna go to orchard" -> {"action":"navigate","destination":"Orchard"}',
  'Input: "take me home" -> {"action":"navigate","destination":"home"}',
  'Input: "what does this bottle say" -> {"action":"read"}',
  'Input: "is this my heart pills" -> {"action":"medicine"}',
  'Input: "it\'s too dark" -> {"action":"torch"}',
  'Input: "what colour is my shirt" -> {"action":"ask","question":"what colour is my shirt"}',
].join("\n");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: "The server has no OpenAI key configured." });

  const { text } = readBody(req);
  if (!text || !String(text).trim()) return res.status(400).json({ error: "No text was provided." });

  let r;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: String(text).slice(0, 300) },
        ],
      }),
    });
  } catch (_) {
    return res.status(502).json({ error: "The AI service couldn't be reached." });
  }

  if (!r.ok) return res.status(502).json({ error: "The AI service had a problem." });

  let parsed = {};
  try { parsed = JSON.parse((await r.json()).choices?.[0]?.message?.content || "{}"); }
  catch (_) { parsed = {}; }

  const ACTIONS = ["navigate", "read", "medicine", "translate", "describe",
                   "around", "torch", "repeat", "stop", "start", "help", "ask"];
  const action = ACTIONS.includes(parsed.action) ? parsed.action : "ask";
  res.status(200).json({
    action,
    destination: typeof parsed.destination === "string" ? parsed.destination.trim() : null,
    question: typeof parsed.question === "string" ? parsed.question.trim() : null,
  });
};

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
