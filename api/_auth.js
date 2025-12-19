const jwt = require('jsonwebtoken');

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function verifyMemberstack(req) {
  const token = getBearerToken(req);
  if (!token) throw new Error('MISSING_AUTH');

  const publicKey = process.env.MEMBERSTACK_JWT_PUBLIC_KEY;
  if (!publicKey) throw new Error('MISSING_MEMBERSTACK_PUBLIC_KEY');

  const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

  const memberId = decoded?.id || decoded?.member_id || decoded?.sub || decoded?.data?.id;
  if (!memberId) throw new Error('MISSING_MEMBER_ID');

  return { memberId, decoded };
}

module.exports = { verifyMemberstack };
