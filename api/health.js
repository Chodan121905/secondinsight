/* GET /api/health — lets the front-end discover the backend and which
   features the server provides keys for (so the UI can skip asking). */
module.exports = (req, res) => {
  if (cors(req, res)) return;
  res.status(200).json({
    ok: true,
    features: {
      vision: !!process.env.OPENAI_API_KEY,
      exa: !!process.env.EXA_API_KEY,
      maps: !!process.env.ORS_API_KEY,
      tracking: true,
    },
  });
};

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}
