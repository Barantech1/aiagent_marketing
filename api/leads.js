// api/leads.js — persistent shared lead storage using Neon Postgres
const { neon } = require('@neondatabase/serverless');

async function getDb() {
  const sql = neon(process.env.DATABASE_URL);
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT, title TEXT, company TEXT, email TEXT,
      segment TEXT, region TEXT, boats_per_year TEXT,
      fit TEXT, score INTEGER DEFAULT 0, status TEXT DEFAULT 'new',
      source TEXT DEFAULT 'ai', linkedin TEXT, website TEXT,
      added TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  return sql;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const sql = await getDb();

    if (req.method === "GET") {
      const rows = await sql`SELECT * FROM leads ORDER BY score DESC, added DESC`;
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const { leads } = req.body;
      let added = 0, skipped = 0;
      for (const l of leads) {
        const id = String(Date.now() + Math.random());
        const norm = (l.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const existing = await sql`
          SELECT id FROM leads WHERE LOWER(REGEXP_REPLACE(company, '[^a-zA-Z0-9]', '', 'g')) = ${norm}
        `;
        if (existing.length > 0) { skipped++; continue; }
        await sql`
          INSERT INTO leads (id, name, title, company, email, segment, region, boats_per_year, fit, score, status, source, linkedin, website)
          VALUES (${id}, ${l.name||''}, ${l.title||''}, ${l.company||''}, ${l.email||''},
                  ${l.segment||''}, ${l.region||''}, ${l.boats_per_year||''},
                  ${l.fit||''}, ${parseInt(l.score)||0}, ${'new'},
                  ${l.source||'ai'}, ${l.linkedin||''}, ${l.website||''})
        `;
        added++;
      }
      const allLeads = await sql`SELECT * FROM leads ORDER BY score DESC, added DESC`;
      return res.status(200).json({ added, skipped, leads: allLeads });
    }

    if (req.method === "DELETE") {
      const { id } = req.body;
      await sql`DELETE FROM leads WHERE id = ${id}`;
      const rows = await sql`SELECT * FROM leads ORDER BY score DESC, added DESC`;
      return res.status(200).json({ leads: rows });
    }

    if (req.method === "PATCH") {
      const { id, status } = req.body;
      const updates = status !== undefined ? await sql`UPDATE leads SET status = ${status} WHERE id = ${id}` : await sql`UPDATE leads SET email = ${req.body.email} WHERE id = ${id}`;
      const rows = await sql`SELECT * FROM leads ORDER BY score DESC, added DESC`;
      return res.status(200).json({ leads: rows });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
