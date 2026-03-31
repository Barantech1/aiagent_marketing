// api/hubspot.js — HubSpot contact lookup and creation
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const hsKey = process.env.HUBSPOT_API_KEY;
  if (!hsKey) return res.status(500).json({ error: "HUBSPOT_API_KEY not set" });

  const { action, lead } = req.body;

  // HubSpot Personal Access Keys use Bearer token auth
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${hsKey}`,
  };

  // CHECK — search for existing contact by email, then by name+company
  if (action === "check") {
    try {
      // 1. Search by email
      if (lead.email) {
        const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
          method: "POST", headers,
          body: JSON.stringify({
            filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: lead.email }] }],
            properties: ["firstname", "lastname", "email", "company", "hs_object_id"],
            limit: 1,
          }),
        });
        const d = await r.json();
        console.log("HubSpot check by email status:", r.status, "total:", d.total, "error:", d.message||"none");
        if (d.total > 0) {
          const c = d.results[0];
          return res.status(200).json({ found: true, hubspot_id: c.id, hubspot_url: `https://app.hubspot.com/contacts/${c.id}` });
        }
      }

      // 2. Search by name
      if (lead.name) {
        const parts = lead.name.trim().split(" ");
        const firstName = parts[0] || "";
        const lastName  = parts.slice(1).join(" ") || "";
        const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
          method: "POST", headers,
          body: JSON.stringify({
            filterGroups: [{
              filters: [
                { propertyName: "firstname", operator: "EQ", value: firstName },
                { propertyName: "lastname",  operator: "EQ", value: lastName },
              ]
            }],
            properties: ["firstname", "lastname", "email", "company", "hs_object_id"],
            limit: 5,
          }),
        });
        const d = await r.json();
        console.log("HubSpot check by name status:", r.status, "total:", d.total, "error:", d.message||"none");
        if (d.total > 0) {
          const match = lead.company
            ? d.results.find(c => (c.properties.company||"").toLowerCase().includes(lead.company.toLowerCase()))
            : d.results[0];
          if (match) {
            return res.status(200).json({ found: true, hubspot_id: match.id, hubspot_url: `https://app.hubspot.com/contacts/${match.id}` });
          }
        }
      }

      return res.status(200).json({ found: false });
    } catch (err) {
      console.log("HubSpot check error:", err.message);
      return res.status(200).json({ found: false, error: err.message });
    }
  }

  // CREATE — add contact to HubSpot
  if (action === "create") {
    try {
      const parts = (lead.name || "").trim().split(" ");
      const firstName = parts[0] || "";
      const lastName  = parts.slice(1).join(" ") || "";

      const properties = {
        firstname:  firstName,
        lastname:   lastName,
        jobtitle:   lead.title   || "",
        company:    lead.company || "",
        website:    lead.website || "",
      };
      if (lead.email)    properties.email    = lead.email;
      if (lead.region)   properties.city     = lead.region;
      if (lead.fit)      properties.description = lead.fit;
      if (lead.linkedin) properties.linkedin_bio = lead.linkedin;

      const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST", headers,
        body: JSON.stringify({ properties }),
      });

      const d = await r.json();
      console.log("HubSpot create status:", r.status, "id:", d.id, "error:", d.message||"none");

      if (r.status === 409 || (d.message && d.message.toLowerCase().includes("already exists"))) {
        // Contact exists — extract ID from error and return it
        const existingId = d.message?.match(/vid=(\d+)/)?.[1] || d.message?.match(/ID: (\d+)/)?.[1];
        return res.status(200).json({
          created: false,
          already_exists: true,
          hubspot_id: existingId || null,
          hubspot_url: existingId ? `https://app.hubspot.com/contacts/${existingId}` : null,
        });
      }

      if (!r.ok) {
        return res.status(200).json({ created: false, error: d.message || `HTTP ${r.status}` });
      }

      return res.status(200).json({
        created: true,
        hubspot_id: d.id,
        hubspot_url: `https://app.hubspot.com/contacts/${d.id}`,
      });
    } catch (err) {
      console.log("HubSpot create error:", err.message);
      return res.status(500).json({ created: false, error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
};
