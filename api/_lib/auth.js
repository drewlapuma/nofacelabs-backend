// api/_lib/auth.// api/_lib/auth.js (CommonJS)
const memberstackAdmin = require("@memberstack/admin");

const secret = process.env.MEMBERSTACK_SECRET_KEY;
const ms = secret ? memberstackAdmin.init(secret) : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function requireMemberId(req) {
  const token = getBearerToken(req);
  if (!token) throw new Error("MISSING_AUTH_TOKEN");
  if (!ms) throw new Error("MISSING_MEMBERSTACK_SECRET_KEY");

  const out = await ms.verifyToken({ token });
  const id = out?.id;
  if (!id) throw new Error("INVALID_MEMBER_TOKEN");

  return String(id);
}

module.exports = { requireMemberId };
