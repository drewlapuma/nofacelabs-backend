const { supabase } = require('./_supabase');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    // Simple shared-secret auth for webhook
    const secret = req.headers['x-webhook-secret'];
    if (!secret || secret !== process.env.CREATOMATE_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'INVALID_WEBHOOK_SECRET' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    console.log('[CREATOMATE_WEBHOOK] IN', body);

    // Creatomate webhook payload varies a bit, so we try common fields:
    const renderId = body?.id || body?.render_id || body?.data?.id;
    const statusRaw = body?.status || body?.data?.status || '';
    const statusLower = String(statusRaw).toLowerCase();

    // video url is often in "url" or "output_url" depending on config
    const videoUrl = body?.url || body?.output_url || body?.data?.url || body?.data?.output_url || null;

    if (!renderId) return res.status(400).json({ error: 'MISSING_RENDER_ID', body });

    let newStatus = 'rendering';
    if (statusLower === 'succeeded' || statusLower === 'completed' || statusLower === 'complete') newStatus = 'complete';
    if (statusLower === 'failed' || statusLower === 'error') newStatus = 'failed';

    const errorMsg =
      body?.error || body?.message || body?.data?.error || body?.data?.message || null;

    const update = {
      status: newStatus,
      video_url: newStatus === 'complete' ? videoUrl : null,
      error: newStatus === 'failed' ? String(errorMsg || 'Render failed') : null,
    };

    const { error } = await supabase
      .from('renders')
      .update(update)
      .eq('render_id', String(renderId));

    if (error) {
      console.error('[CREATOMATE_WEBHOOK] DB_UPDATE_FAILED', error);
      return res.status(500).json({ error: 'DB_UPDATE_FAILED', details: error });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[CREATOMATE_WEBHOOK] ERROR', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: String(e?.message || e) });
  }
};
