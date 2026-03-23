const { createClient } = require("@supabase/supabase-js");
const { getCreditBalance } = require("../lib/credits");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-nf-member-id, x-nf-member-email");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

  const memberId = String(req.headers["x-nf-member-id"] || "anonymous").trim();
  if (!memberId || memberId === "anonymous") {
    return json(res, 400, { ok: false, error: "Missing member id" });
  }

  try {
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const balance = await getCreditBalance(supabaseAdmin, memberId);

    return json(res, 200, {
      ok: true,
      memberId,
      balance: balance.balance,
      lifetimePurchased: balance.lifetime_purchased,
      lifetimeUsed: balance.lifetime_used
    });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err.message || "Failed to fetch balance"
    });
  }
};
