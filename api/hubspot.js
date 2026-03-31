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
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${hsKey}`,
  };

  // CHECK — search for existing contact by email, then by name+company
  if (action === "check") {
    try {
      // 1. Search by email first
      if (lead.email) {
        const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
          method: "POST",
          headers,
          body: JSON.stringify({
            filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: lead.email }] }],
            properties: ["firstname", "lastname", "email", "company", "jobtitle", "hs_object_id"],
            limit: 1,
          }),
        });
        const searchData = await searchRes.json();
        if (searchData.total > 0) {
          const contact = searchData.results[0];
          return res.status(200).json({
            found: true,
            hubspot_id: contact.id,
            hubspot_url: `https://app.hubspot.com/contacts/${contact.properties.hs_object_id || contact.id}`,
          });
        }
      }

      // 2. Search by name + company if no email match
      if (lead.name) {
        const parts = lead.name.trim().split(" ");
        const firstName = parts[0] || "";
        const lastName = parts.slice(1).join(" ") || "";
        const nameRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
          method: "POST",
          headers,
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
        const nameData = await nameRes.json();
        // Filter by company if we have it
        if (nameData.total > 0) {
          const match = lead.company
            ? nameData.results.find(c => (c.properties.company||"").toLowerCase().includes(lead.company.toLowerCase()))
            : nameData.results[0];
          if (match) {
            return res.status(200).json({
              found: true,
              hubspot_id: match.id,
              hubspot_url: `https://app.hubspot.com/contacts/${match.properties.hs_object_id || match.id}`,
            });
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

      const createRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          properties: {
            firstname:        firstName,
            lastname:         lastName,
            email:            lead.email        || "",
            company:          lead.company      || "",
            jobtitle:         lead.title        || "",
            phone:            "",
            website:          lead.website      || "",
            linkedin_bio:     lead.linkedin     || "",
            city:             lead.region       || "",
            hs_lead_status:   "NEW",
            description:      lead.fit          || "",
          }
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        // Handle duplicate contact gracefully
        if (createData.message && createData.message.includes("Contact already exists")) {
          const existingId = createData.message.match(/ID: (\d+)/)?.[1];
          return res.status(200).json({
            created: false,
            already_exists: true,
            hubspot_id: existingId,
            hubspot_url: existingId ? `https://app.hubspot.com/contacts/${existingId}` : null,
          });
        }
        return res.status(200).json({ created: false, error: createData.message });
      }

      return res.status(200).json({
        created: true,
        hubspot_id: createData.id,
        hubspot_url: `https://app.hubspot.com/contacts/${createData.id}`,
      });
    } catch (err) {
      return res.status(500).json({ created: false, error: err.message });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
};
