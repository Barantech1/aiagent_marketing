// api/auth.js — simple password login, returns a session token
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { password } = req.body;
  const correctPassword = process.env.APP_PASSWORD || "barantech2024";

  if (password !== correctPassword) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  // Simple token: base64 of password + timestamp
  const token = Buffer.from(`${password}:${Date.now()}`).toString("base64");
  return res.status(200).json({ token });
};
