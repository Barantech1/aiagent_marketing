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

  const titleMap = {
    'Any decision maker':                       ['CEO', 'Owner', 'Founder', 'Director', 'Managing Director', 'General Manager'],
    'CEO / Owner':                              ['CEO', 'Owner', 'Founder', 'President', 'Managing Director'],
    'Product / R&D Director':                   ['Product Director', 'R&D Director', 'Engineering Director', 'Head of Engineering'],
    'Head of Electrical / Systems Engineering': ['Electrical Engineer', 'Systems Engineer', 'Naval Architect', 'Marine Engineer'],
    'Purchasing / Procurement Manager':         ['Purchasing Manager', 'Procurement Manager', 'Supply Chain Manager'],
    'Sales / Business Development':             ['Sales Director', 'VP Sales', 'Business Development Manager', 'Commercial Director'],
  };

  const regionMap = {
    'Global':        null,
    'North America': ['United States', 'Canada'],
    'Europe':        ['United Kingdom', 'France', 'Germany', 'Italy', 'Netherlands', 'Spain', 'Sweden', 'Norway', 'Denmark'],
    'APAC':          ['Australia', 'New Zealand', 'Japan', 'Singapore'],
    'Middle East':   ['United Arab Emirates', 'Saudi Arabia', 'Qatar'],
    'Mediterranean': ['Italy', 'France', 'Spain', 'Greece', 'Croatia', 'Turkey'],
  };

  const titles = titleMap[role] || titleMap['Any decision maker'];
  const countries = regionMap[region] || null;

  // Use the new Apollo endpoint: mixed_people/api_search
  const searches = [
    { q_keywords: 'boat manufacturer yacht builder marine' },
    { q_keywords: 'yacht manufacturing boatbuilder' },
    { q_keywords: 'marine manufacturer shipyard vessel' },
    { q_keywords: 'boat builder marine' },
  ];

  let allPeople = [];

  for (const search of searches) {
    if (allPeople.length >= 8) break;
    try {
      const payload = {
        per_page: 10,
        person_titles: titles,
        ...search,
        ...(countries && { person_locations: countries }),
      };

      const apolloRes = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apolloKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await apolloRes.json();
      console.log('Apollo search:', search.q_keywords, '| status:', apolloRes.status, '| people:', data.people?.length || 0, '| error:', data.error || 'none');

      if (data.error) {
        console.log('Apollo error detail:', JSON.stringify(data));
        return res.status(200).json({ leads: [], debug: { apollo_error: data.error, payload } });
      }

      if (data.people?.length > 0) {
        const existingIds = new Set(allPeople.map(p => p.id));
        allPeople = [...allPeople, ...data.people.filter(p => !existingIds.has(p.id))];
      }
    } catch (err) {
      console.log('Apollo fetch error:', err.message);
    }
  }

  if (!allPeople.length) {
    return res.status(200).json({
      leads: [],
      message: 'Apollo returned no contacts for these filters. Try broadening your search or switching to AI mode.',
      debug: { titles, countries }
    });
  }

  // Enrich with Hunter
  const leads = await Promise.all(allPeople.slice(0, 10).map(async (person) => {
    let email = person.email || '';
    const domain = person.organization?.primary_domain || '';

    // Try Hunter name+domain lookup if no email from Apollo
    if (!email && domain) {
      try {
        const firstName = encodeURIComponent(person.first_name || '');
        const lastName  = encodeURIComponent(person.last_name  || '');
        const hunterUrl = `https://api.hunter.io/v2/email-finder?domain=${domain}&first_name=${firstName}&last_name=${lastName}&api_key=${hunterKey}`;
        const hunterRes  = await fetch(hunterUrl);
        const hunterData = await hunterRes.json();
        console.log('Hunter name lookup:', domain, '->', hunterData.data?.email || 'not found');
        if (hunterData.data?.email) email = hunterData.data.email;
      } catch (err) {
        console.log('Hunter name error:', err.message);
      }
    }

    // Fallback: Hunter domain search
    if (!email && domain) {
      try {
        const hunterUrl = `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=1&api_key=${hunterKey}`;
        const hunterRes  = await fetch(hunterUrl);
        const hunterData = await hunterRes.json();
        const first = hunterData.data?.emails?.[0];
        if (first?.value) {
          email = first.value;
          console.log('Hunter domain fallback:', domain, '->', email);
        }
      } catch (err) {
        console.log('Hunter domain error:', err.message);
      }
    }

    return {
      name:           `${person.first_name || ''} ${person.last_name || ''}`.trim(),
      title:          person.title || '',
      company:        person.organization?.name || '',
      email:          email,
      linkedin:       person.linkedin_url || '',
      region:         person.city ? `${person.city}, ${person.country || ''}` : (person.organization?.country || region),
      segment:        segments,
      website:        person.organization?.website_url || (domain ? `https://${domain}` : ''),
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
