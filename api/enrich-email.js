// api/enrich-email.js — on-demand Hunter email lookup for a single lead
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const hunterKey = process.env.HUNTER_API_KEY;
  if (!hunterKey) return res.status(500).json({ error: "HUNTER_API_KEY not set" });

  const { domain, firstName, lastName } = req.body;
  if (!domain) return res.status(400).json({ error: "domain required" });

  // Try name + domain first
  try {
    const url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName||'')}&last_name=${encodeURIComponent(lastName||'')}&api_key=${hunterKey}`;
    const res2 = await fetch(url);
    const data = await res2.json();
    if (data.data?.email) return res.status(200).json({ email: data.data.email, source: 'hunter-name' });
  } catch(e) {}

  // Fallback: domain search
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=1&api_key=${hunterKey}`;
    const res2 = await fetch(url);
    const data = await res2.json();
    const email = data.data?.emails?.[0]?.value;
    if (email) return res.status(200).json({ email, source: 'hunter-domain' });
  } catch(e) {}

  return res.status(200).json({ email: null });
};
