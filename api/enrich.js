// api/enrich.js — fetches real contacts from Apollo and verifies emails via Hunter
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apolloKey = process.env.APOLLO_API_KEY;
  const hunterKey = process.env.HUNTER_API_KEY;

  const { segments, vessel, region, role, criteria } = req.body;

  // Map our UI segments/roles to Apollo filters
  const titleMap = {
    'Any decision maker': ['CEO', 'CTO', 'Director', 'VP', 'Head of', 'Owner', 'Founder'],
    'CEO / Owner': ['CEO', 'Owner', 'Founder', 'Managing Director'],
    'Product / R&D Director': ['Product Director', 'R&D Director', 'Head of Product', 'Engineering Director'],
    'Head of Electrical / Systems Engineering': ['Electrical Engineer', 'Systems Engineer', 'Head of Engineering', 'Naval Architect'],
    'Purchasing / Procurement Manager': ['Purchasing Manager', 'Procurement Manager', 'Supply Chain'],
    'Sales / Business Development': ['Sales Director', 'Business Development', 'VP Sales', 'Commercial Director'],
  };

  const industryKeywords = [
    'boat', 'yacht', 'marine', 'naval', 'shipbuilding', 'vessel', 'maritime'
  ];

  const regionMap = {
    'Global': null,
    'North America': ['United States', 'Canada'],
    'Europe': ['United Kingdom', 'France', 'Germany', 'Italy', 'Netherlands', 'Spain', 'Sweden', 'Norway', 'Finland'],
    'APAC': ['Australia', 'New Zealand', 'Japan', 'Singapore'],
    'Middle East': ['United Arab Emirates', 'Saudi Arabia', 'Qatar'],
    'Mediterranean': ['Italy', 'France', 'Spain', 'Greece', 'Croatia', 'Turkey'],
  };

  const titles = titleMap[role] || titleMap['Any decision maker'];
  const countries = regionMap[region] || null;

  try {
    // Step 1: Search Apollo for people
    const apolloPayload = {
      per_page: 10,
      person_titles: titles,
      q_keywords: industryKeywords.slice(0, 3).join(' '),
      ...(countries && { person_locations: countries }),
    };

    const apolloRes = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apolloKey,
      },
      body: JSON.stringify(apolloPayload),
    });

    const apolloData = await apolloRes.json();
    const people = apolloData.people || [];

    if (!people.length) {
      return res.status(200).json({ leads: [], source: 'apollo', message: 'No results from Apollo for these filters' });
    }

    // Step 2: For each person, try Hunter to get/verify email
    const leads = await Promise.all(people.slice(0, 8).map(async (person) => {
      let email = person.email || '';

      // If Apollo didn't return an email, try Hunter
      if (!email && person.organization?.primary_domain) {
        try {
          const firstName = person.first_name || '';
          const lastName = person.last_name || '';
          const domain = person.organization.primary_domain;
          const hunterUrl = `https://api.hunter.io/v2/email-finder?domain=${domain}&first_name=${firstName}&last_name=${lastName}&api_key=${hunterKey}`;
          const hunterRes = await fetch(hunterUrl);
          const hunterData = await hunterRes.json();
          email = hunterData.data?.email || '';
        } catch (_) {}
      }

      return {
        name: `${person.first_name || ''} ${person.last_name || ''}`.trim(),
        title: person.title || '',
        company: person.organization?.name || '',
        email: email,
        linkedin: person.linkedin_url || '',
        region: person.location || person.organization?.country || region,
        segment: segments,
        website: person.organization?.website_url || person.organization?.primary_domain || '',
        employees: person.organization?.estimated_num_employees || '',
        boats_per_year: '',
        fit: '',
        score: 0,
        source: 'apollo',
        status: 'new',
      };
    }));

    return res.status(200).json({ leads, source: 'apollo+hunter' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
