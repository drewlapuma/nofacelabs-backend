// api/_lib/auth.js (CommonJS)
const memberstackAdmin = require("@memberstack/admin");

const ms = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);

async function requireMemberId(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new Error("MISSING_AUTH_TOKEN");

  const { id } = await ms.verifyToken({ token });
  if (!id) throw new Error("INVALID_MEMBER_TOKEN");

  return id; // member_id
}

module.exports = { requireMemberId };
