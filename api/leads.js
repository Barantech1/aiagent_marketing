// api/leads.js — CRUD endpoints for persistent shared lead storage using Vercel KV
const { kv } = require('@vercel/kv');

const LEADS_KEY = 'barantech:leads';

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — fetch all leads
  if (req.method === "GET") {
    try {
      const leads = await kv.get(LEADS_KEY) || [];
      return res.status(200).json(leads);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — add new leads (deduplicates by company domain/name)
  if (req.method === "POST") {
    try {
      const { leads: newLeads } = req.body;
      const existing = await kv.get(LEADS_KEY) || [];
      const existingKeys = new Set(existing.map(l => normalise(l.company)));
      const deduped = newLeads.filter(l => !existingKeys.has(normalise(l.company)));
      const merged = [...existing, ...deduped.map(l => ({ ...l, id: Date.now() + Math.random(), status: 'new', added: new Date().toISOString() }))];
      await kv.set(LEADS_KEY, merged);
      return res.status(200).json({ added: deduped.length, skipped: newLeads.length - deduped.length, leads: merged });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE — remove a lead by id
  if (req.method === "DELETE") {
    try {
      const { id } = req.body;
      const existing = await kv.get(LEADS_KEY) || [];
      const updated = existing.filter(l => l.id !== id);
      await kv.set(LEADS_KEY, updated);
      return res.status(200).json({ leads: updated });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PATCH — update lead status
  if (req.method === "PATCH") {
    try {
      const { id, status } = req.body;
      const existing = await kv.get(LEADS_KEY) || [];
      const updated = existing.map(l => l.id === id ? { ...l, status } : l);
      await kv.set(LEADS_KEY, updated);
      return res.status(200).json({ leads: updated });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};

function normalise(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
