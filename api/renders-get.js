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
    const id = req.query?.id;
    if (!id) return res.status(400).json({ error: 'MISSING_ID' });

    const { data, error } = await supabase
      .from('renders')
      .select('id, render_id, status, video_url, choices, error, created_at')
      .eq('id', id)
      .eq('member_id', memberId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: String(e?.message || e) });
  }
};
