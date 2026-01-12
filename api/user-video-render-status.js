// api/user-video-render-status.js (CommonJS, Node 18+)
const https = require("https");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { method: "GET", hostname: u.hostname, path: u.pathname + (u.search || ""), headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data || "{}");
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
            return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } catch {
            return reject(new Error(`Bad JSON response: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
  if (!CREATOMATE_API_KEY) return json(res, 500, { error: "Missing CREATOMATE_API_KEY" });

  const id = req.url.includes("?") ? new URL(req.url, "http://x").searchParams.get("id") : null;
  if (!id) return json(res, 400, { error: "id required" });

  try {
    const render = await getJson(`https://api.creatomate.com/v1/renders/${encodeURIComponent(id)}`, {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
    });

    return json(res, 200, {
      id: render?.id,
      status: render?.status,
      url: render?.url || null,
      error: render?.error || null,
    });
  } catch (e) {
    return json(res, 500, { error: "CREATOMATE_STATUS_FAILED", details: String(e.message || e) });
  }
};
