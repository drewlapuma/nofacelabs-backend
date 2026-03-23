const { createClient } = require("@supabase/supabase-js");
const { addCredits } = require("../lib/credits");

const ADMIN_SECRET = process.env.ADMIN_CREDIT_SECRET;

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false });

  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }

  try {
    const body = await readJson(req);
    const memberId = String(body.memberId || "").trim();
    const amount = Number(body.amount || 0);

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const result = await addCredits({
      supabaseAdmin,
      memberId,
      amount,
      reason: "manual_credit_add",
      countsAsPurchase: true,
      metadata: { source: "admin" }
    });

    return json(res, 200, {
      ok: true,
      memberId,
      amount,
      balanceAfter: result.balanceAfter
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
};
