// api/krea-image.js (CommonJS, Node 18)
// Returns the image bytes if available.
// If upstream fails, returns a tiny PNG placeholder so Creatomate never goes black,
// and logs the real reason in Vercel.

const PLACEHOLDER_PNG_BASE64 =
  // 1x1 transparent png
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/P9f9mQAAAABJRU5ErkJggg==';

module.exports = async function handler(req, res) {
  const url = String(req.query?.url || '');

  try {
    if (!url.startsWith('https://')) {
      console.error('[KREA_PROXY] bad url', { url });
      return res.status(400).send('Bad url');
    }

    const host = new URL(url).hostname;

    // Widen allowlist to cover Krea/CDN variations
    const allowed = [
      'gen.krea.ai',
      'api.krea.ai',
      'cdn.krea.ai',
      'images.krea.ai',
      'storage.googleapis.com',
      'cdn.discordapp.com', // remove if not needed
    ];

    if (!allowed.some((h) => host === h || host.endsWith('.' + h))) {
      console.error('[KREA_PROXY] host not allowed', { host, url });
      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64'));
    }

    const upstream = await fetch(url, { redirect: 'follow' });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => '');
      console.error('[KREA_PROXY] upstream not ok', {
        status: upstream.status,
        host,
        url,
        bodyPreview: txt.slice(0, 200),
      });

      res.setHeader('Content-Type', 'image/png');
      return res.status(200).send(Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64'));
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buf = Buffer.from(await upstream.arrayBuffer());
    console.log('[KREA_PROXY] ok', { host, bytes: buf.length });
    return res.status(200).send(buf);
  } catch (e) {
    console.error('[KREA_PROXY] exception', { url, message: String(e?.message || e) });
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64'));
  }
};
