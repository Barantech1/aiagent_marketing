// api/proxy.js  –  Vercel serverless function
// Proxies requests to the Anthropic API, adding your secret API key server-side.
//
// SETUP:
//   1. Add your Anthropic API key in Vercel dashboard → Settings → Environment Variables
//      Name: ANTHROPIC_API_KEY   Value: sk-ant-...
//   2. Deploy this file to Vercel (see vercel.json for routing config)

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Use server env key if set, otherwise accept from request body (for personal use)
  const apiKey = process.env.ANTHROPIC_API_KEY || req.body._apiKey;
  if (!apiKey) return res.status(500).json({ error: "No API key provided" });

  // Strip _apiKey before forwarding to Anthropic
  const { _apiKey, ...body } = req.body;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
