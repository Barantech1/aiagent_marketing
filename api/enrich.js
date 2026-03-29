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

  // Apollo valid search fields — use q_keywords for full-text, person_titles for roles
  // Try progressively broader searches until we get results
  const searches = [
    { q_keywords: 'boat manufacturer yacht builder marine', person_titles: titles },
    { q_keywords: 'yacht manufacturing boatbuilder', person_titles: titles },
    { q_keywords: 'marine manufacturer shipyard', person_titles: titles },
    { q_keywords: 'boat builder marine vessel', person_titles: ['CEO', 'Owner', 'Director', 'Founder'] },
    { q_keywords: 'yacht boat marine', person_titles: ['CEO', 'Owner', 'Founder'] },
  ];

  let allPeople = [];

  for (const search of searches) {
    if (allPeople.length >= 8) break;
    try {
      const payload = {
        per_page: 10,
        ...search,
        ...(countries && { person_locations: countries }),
      };

      const apolloRes = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apolloKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await apolloRes.json();

      // Log full response for debugging
      console.log('Apollo search:', JSON.stringify(search));
      console.log('Apollo status:', apolloRes.status);
      console.log('Apollo error:', data.error || 'none');
      console.log('Apollo people count:', data.people?.length || 0);
      console.log('Apollo pagination:', JSON.stringify(data.pagination));

      if (data.error) {
        console.log('Apollo error detail:', JSON.stringify(data));
        // Return the error so we can see it in the UI
        return res.status(200).json({
          leads: [],
          debug: { apollo_error: data.error, apollo_status: apolloRes.status, payload }
        });
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
      message: 'Apollo returned no contacts. This usually means the free plan does not include People Search API access. Try switching to AI mode.',
      debug: { titles, countries }
    });
  }

  // Enrich with Hunter — called for every person, with or without Apollo email
  const leads = await Promise.all(allPeople.slice(0, 10).map(async (person) => {
    let email = person.email || '';
    let emailSource = email ? 'apollo' : '';

    // Always try Hunter if we have a domain, even if Apollo gave us an email (Hunter may be more accurate)
    const domain = person.organization?.primary_domain || '';
    if (domain && !email) {
      try {
        const firstName = encodeURIComponent(person.first_name || '');
        const lastName  = encodeURIComponent(person.last_name  || '');
        const hunterUrl = `https://api.hunter.io/v2/email-finder?domain=${domain}&first_name=${firstName}&last_name=${lastName}&api_key=${hunterKey}`;
        const hunterRes  = await fetch(hunterUrl);
        const hunterData = await hunterRes.json();
        console.log('Hunter result for', domain, ':', hunterData.data?.email || 'not found', 'score:', hunterData.data?.score);
        if (hunterData.data?.email) {
          email = hunterData.data.email;
          emailSource = 'hunter';
        }
      } catch (err) {
        console.log('Hunter error:', err.message);
      }
    }

    // If still no email, try Hunter domain search to get any email pattern
    if (!email && domain) {
      try {
        const hunterDomainUrl = `https://api.hunter.io/v2/domain-search?domain=${domain}&limit=1&api_key=${hunterKey}`;
        const hunterDomainRes  = await fetch(hunterDomainUrl);
        const hunterDomainData = await hunterDomainRes.json();
        const firstEmail = hunterDomainData.data?.emails?.[0];
        if (firstEmail?.value) {
          email = firstEmail.value;
          emailSource = 'hunter-domain';
          console.log('Hunter domain fallback for', domain, ':', email);
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
      email_source:   emailSource,
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
