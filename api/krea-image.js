// api/krea-image.js (CommonJS, Node 18)
module.exports = async function handler(req, res) {
  try {
    const url = String(req.query?.url || '');
    if (!url.startsWith('https://')) return res.status(400).send('Bad url');

    const host = new URL(url).hostname;

    // ✅ Add gen.krea.ai (this is what your logs show)
    // Also allow common Krea/CDN hosts.
    const allowed = [
      'gen.krea.ai',
      'api.krea.ai',
      'cdn.krea.ai',
      'images.krea.ai',
      'storage.googleapis.com',
    ];

    if (!allowed.some((h) => host === h || host.endsWith('.' + h))) {
      console.error('[KREA_PROXY] Host not allowed', { host, url });
      return res.status(403).send('Host not allowed');
    }

    const upstream = await fetch(url, { redirect: 'follow' });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => '');
      console.error('[KREA_PROXY] upstream failed', upstream.status, url, txt.slice(0, 200));
      return res.status(502).send('Upstream fetch failed');
    }

    // Pass through content type so Creatomate recognizes it as an image
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');

    // Creatomate may request many times; caching helps
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buf);
  } catch (e) {
    console.error('[KREA_PROXY] error', e);
    return res.status(500).send('Server error');
  }
};
