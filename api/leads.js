// api/leads.js — persistent shared lead storage using Neon (Postgres via @vercel/postgres)
const { sql } = require('@vercel/postgres');

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT, title TEXT, company TEXT, email TEXT,
      segment TEXT, region TEXT, boats_per_year TEXT,
      fit TEXT, score INTEGER, status TEXT DEFAULT 'new',
      source TEXT DEFAULT 'ai', linkedin TEXT, website TEXT,
      added TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    await ensureTable();

    // GET — fetch all leads ordered by score desc
    if (req.method === "GET") {
      const { rows } = await sql`SELECT * FROM leads ORDER BY score DESC, added DESC`;
      return res.status(200).json(rows);
    }

    // POST — insert new leads, skip duplicates by company name
    if (req.method === "POST") {
      const { leads } = req.body;
      let added = 0, skipped = 0;

      for (const l of leads) {
        const id = String(Date.now() + Math.random());
        const normalised = (l.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        // Check for duplicate company
        const { rows } = await sql`
          SELECT id FROM leads WHERE LOWER(REGEXP_REPLACE(company, '[^a-zA-Z0-9]', '', 'g')) = ${normalised}
        `;
        if (rows.length > 0) { skipped++; continue; }
        await sql`
          INSERT INTO leads (id, name, title, company, email, segment, region, boats_per_year, fit, score, status, source, linkedin, website)
          VALUES (${id}, ${l.name||''}, ${l.title||''}, ${l.company||''}, ${l.email||''},
                  ${l.segment||''}, ${l.region||''}, ${l.boats_per_year||''},
                  ${l.fit||''}, ${parseInt(l.score)||0}, ${'new'},
                  ${l.source||'ai'}, ${l.linkedin||''}, ${l.website||''})
        `;
        added++;
      }

      const { rows: allLeads } = await sql`SELECT * FROM leads ORDER BY score DESC, added DESC`;
      return res.status(200).json({ added, skipped, leads: allLeads });
    }

    // DELETE — remove lead by id
    if (req.method === "DELETE") {
      const { id } = req.body;
      await sql`DELETE FROM leads WHERE id = ${id}`;
      const { rows } = await sql`SELECT * FROM leads ORDER BY score DESC, added DESC`;
      return res.status(200).json({ leads: rows });
    }

    // PATCH — update lead status
    if (req.method === "PATCH") {
      const { id, status } = req.body;
      await sql`UPDATE leads SET status = ${status} WHERE id = ${id}`;
      const { rows } = await sql`SELECT * FROM leads ORDER BY score DESC, added DESC`;
      return res.status(200).json({ leads: rows });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
