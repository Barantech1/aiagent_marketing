// api/enrich.js — fetches real contacts from Apollo and verifies emails via Hunter
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apolloKey = process.env.APOLLO_API_KEY;
  const hunterKey = process.env.HUNTER_API_KEY;

  if (!apolloKey) return res.status(500).json({ error: "APOLLO_API_KEY not set" });
  if (!hunterKey) return res.status(500).json({ error: "HUNTER_API_KEY not set" });

  const { segments, region, role } = req.body;

  // Title keywords mapped from role selector
  const titleMap = {
    'Any decision maker':                        ['CEO', 'Owner', 'Founder', 'Director', 'VP', 'President', 'Managing Director', 'General Manager'],
    'CEO / Owner':                               ['CEO', 'Owner', 'Founder', 'President', 'Managing Director'],
    'Product / R&D Director':                    ['Product Director', 'R&D Director', 'Engineering Director', 'Head of Engineering', 'Head of Product'],
    'Head of Electrical / Systems Engineering':  ['Electrical Engineer', 'Systems Engineer', 'Lead Engineer', 'Naval Architect', 'Marine Engineer'],
    'Purchasing / Procurement Manager':          ['Purchasing Manager', 'Procurement Manager', 'Supply Chain Manager', 'Buyer'],
    'Sales / Business Development':              ['Sales Director', 'VP Sales', 'Business Development Manager', 'Commercial Director', 'Sales Manager'],
  };

  // Industry keywords Apollo understands for marine sector
  const marineKeywords = [
    'boat manufacturing', 'yacht builder', 'marine manufacturer',
    'boatbuilder', 'shipyard', 'vessel manufacturer',
    'marine dealer', 'marine distributor', 'boat dealer',
    'marine electronics', 'marine systems', 'naval architecture'
  ];

  // Country lists per region
  const regionMap = {
    'Global':        null,
    'North America': ['United States', 'Canada'],
    'Europe':        ['United Kingdom', 'France', 'Germany', 'Italy', 'Netherlands', 'Spain', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Poland'],
    'APAC':          ['Australia', 'New Zealand', 'Japan', 'Singapore', 'South Korea'],
    'Middle East':   ['United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Bahrain', 'Kuwait'],
    'Mediterranean': ['Italy', 'France', 'Spain', 'Greece', 'Croatia', 'Turkey', 'Malta'],
  };

  const titles = titleMap[role] || titleMap['Any decision maker'];
  const countries = regionMap[region] || null;

  // Try multiple keyword combinations to maximise results
  const keywordSets = [
    'boat manufacturer yacht builder',
    'marine manufacturer boatbuilder',
    'yacht manufacturing boat builder',
    'shipyard vessel builder marine',
  ];

  let allPeople = [];

  for (const keywords of keywordSets) {
    if (allPeople.length >= 10) break;

    try {
      const payload = {
        per_page: 10,
        person_titles: titles,
        q_organization_keyword_tags: keywords,
        ...(countries && { person_locations: countries }),
      };

      console.log('Apollo request:', JSON.stringify(payload));

      const apolloRes = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apolloKey,
        },
        body: JSON.stringify(payload),
      });

      const apolloData = await apolloRes.json();
      console.log('Apollo response status:', apolloRes.status, 'people:', apolloData.people?.length || 0, 'error:', apolloData.error);

      if (apolloData.people && apolloData.people.length > 0) {
        // Dedupe by person id
        const existingIds = new Set(allPeople.map(p => p.id));
        const newPeople = apolloData.people.filter(p => !existingIds.has(p.id));
        allPeople = [...allPeople, ...newPeople];
      }
    } catch (err) {
      console.log('Apollo fetch error:', err.message);
    }
  }

  // Fallback: try broader search without keyword tags if still no results
  if (allPeople.length === 0) {
    try {
      const fallbackPayload = {
        per_page: 10,
        person_titles: titles,
        q_keywords: 'marine boat yacht',
        ...(countries && { person_locations: countries }),
      };

      const fallbackRes = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apolloKey,
        },
        body: JSON.stringify(fallbackPayload),
      });

      const fallbackData = await fallbackRes.json();
      console.log('Fallback Apollo response:', fallbackData.people?.length || 0, 'error:', fallbackData.error);

      if (fallbackData.people && fallbackData.people.length > 0) {
        allPeople = fallbackData.people;
      }

      // Return debug info if still nothing
      if (allPeople.length === 0) {
        return res.status(200).json({
          leads: [],
          debug: {
            apollo_response: fallbackData,
            message: 'Apollo returned no results. Check API key permissions or try AI mode.'
          }
        });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Apollo fallback failed: ' + err.message });
    }
  }

  // Enrich with Hunter emails where Apollo doesn't provide one
  const leads = await Promise.all(allPeople.slice(0, 10).map(async (person) => {
    let email = person.email || '';

    if (!email && person.organization?.primary_domain) {
      try {
        const firstName = encodeURIComponent(person.first_name || '');
        const lastName  = encodeURIComponent(person.last_name  || '');
        const domain    = person.organization.primary_domain;
        const hunterUrl = `https://api.hunter.io/v2/email-finder?domain=${domain}&first_name=${firstName}&last_name=${lastName}&api_key=${hunterKey}`;
        const hunterRes  = await fetch(hunterUrl);
        const hunterData = await hunterRes.json();
        email = hunterData.data?.email || '';
        console.log('Hunter result for', domain, ':', email || 'not found');
      } catch (_) {}
    }

    return {
      name:           `${person.first_name || ''} ${person.last_name || ''}`.trim(),
      title:          person.title || '',
      company:        person.organization?.name || '',
      email:          email,
      linkedin:       person.linkedin_url || '',
      region:         person.city
                        ? `${person.city}, ${person.country || ''}`
                        : (person.organization?.country || region),
      segment:        segments,
      website:        person.organization?.website_url || person.organization?.primary_domain || '',
      employees:      person.organization?.estimated_num_employees || '',
      boats_per_year: '',
      fit:            '',
      score:          0,
      source:         'apollo',
      status:         'new',
    };
  }));

  return res.status(200).json({ leads, source: 'apollo+hunter', total: leads.length });
};
