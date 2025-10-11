// utils/cors.js
export function setCORS(res, origin = 'https://nofacelabsai.webflow.io') {
  // Use your actual Webflow site origin above.
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // If you need cookies across origins, also set:
  // res.setHeader('Access-Control-Allow-Credentials', 'true');
}

export const withCORS = (handler, origin = 'https://nofacelabsai.webflow.io') =>
  async (req, res) => {
    setCORS(res, origin);
    if (req.method === 'OPTIONS') return res.status(200).end();
    return handler(req, res);
  };
