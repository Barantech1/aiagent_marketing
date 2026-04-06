// api/hubspot.js — sends lead data to Zapier webhook which creates HubSpot contact
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (!zapierUrl) return res.status(500).json({ error: "ZAPIER_WEBHOOK_URL not set" });

  const { action, lead } = req.body;

  // We can't check HubSpot directly without API access,
  // so check action and send to Zapier for create
  if (action === "check") {
    // Without direct HubSpot API we can't check — return not found
    // so the Add button always shows for unsynced leads
    return res.status(200).json({ found: false });
  }

  if (action === "create") {
    try {
      const parts = (lead.name || "").trim().split(" ");
      const firstName = parts[0] || "";
      const lastName  = parts.slice(1).join(" ") || "";

      const payload = {
        firstname:     firstName,
        lastname:      lastName,
        email:         lead.email    || "",
        jobtitle:      lead.title    || "",
        company:       lead.company  || "",
        website:       lead.website  || "",
        city:          lead.region   || "",
        linkedin_bio:  lead.linkedin || "",
        description:   lead.fit      || "",
        lead_source:   "Cruzo Lead Agent",
        lead_score:    lead.score    || "",
        segment:       lead.segment  || "",
      };

      const zapRes = await fetch(zapierUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("Zapier webhook status:", zapRes.status);

      if (!zapRes.ok) {
        const text = await zapRes.text();
        console.log("Zapier error:", text);
        return res.status(200).json({ created: false, error: `Zapier returned ${zapRes.status}` });
      }

      // Return a synthetic ID based on timestamp since we don't get one back from Zapier
      const syntheticId = `zapier_${Date.now()}`;
      return res.status(200).json({
        created: true,
        hubspot_id: syntheticId,
        hubspot_url: null, // No direct URL without HubSpot API
      });

    } catch (err) {
      console.log("Zapier error:", err.message);
      return res.status(500).json({ created: false, error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
};
