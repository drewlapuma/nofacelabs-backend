const { supabase } = require('./_supabase');
const { verifyMemberstack } = require('./_auth');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const { memberId } = verifyMemberstack(req);

    const { data, error } = await supabase
      .from('renders')
      .select('id, render_id, status, video_url, choices, error, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: 'DB_QUERY_FAILED', details: error });
    return res.status(200).json({ ok: true, items: data || [] });
  } catch (e) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: String(e?.message || e) });
  }
};
