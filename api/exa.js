/* POST /api/exa  { labelText }  → { answer }
   Medicine enrichment via Exa, key from env (EXA_API_KEY). Best-effort:
   returns { answer: null } on any failure so the caller never breaks. */
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });

  const key = process.env.EXA_API_KEY;
  if (!key) return res.status(200).json({ answer: null });

  const { labelText } = readBody(req);
  if (!labelText) return res.status(200).json({ answer: null });

  const query =
    "Based on this medicine label text, in two short sentences: what is this " +
    "medication commonly used to treat, and what is its single most important " +
    "safety warning? If unsure, say so.\n\nLabel text:\n" + labelText;

  try {
    const r = await fetch("https://api.exa.ai/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, text: true }),
    });
    if (!r.ok) return res.status(200).json({ answer: null });
    const data = await r.json();
    res.status(200).json({ answer: (data?.answer || "").trim() || null });
  } catch (_) {
    res.status(200).json({ answer: null });
  }
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
