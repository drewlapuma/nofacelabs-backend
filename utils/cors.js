// utils/cors.js  (CommonJS)
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'https://nofacelabsai.webflow.io';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function allowCors(handler) {
  return async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    return handler(req, res);
  };
}

module.exports = { allowCors, setCors };
