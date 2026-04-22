const { listJobsByUser } = require("../_lib/skeleton-jobs");

function setCors(req, res) {
  const allowedOrigins = [
    "https://nofacelabsai.webflow.io",
    "https://nofacelabs.ai",
    "http://localhost:3000",
  ];

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-nf-member-id, x-nf-member-email"
  );
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getUserId(req) {
  return (
    req.headers["x-nf-member-id"] ||
    req.headers["x-member-id"] ||
    req.headers["x-user-id"] ||
    null
  );
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.method !== "GET") {
      return send(res, 405, { error: "Method not allowed" });
    }

    const userId = getUserId(req);
    const jobs = await listJobsByUser(userId, 50);

    return send(res, 200, {
      ok: true,
      jobs,
    });
  } catch (error) {
    console.error("[api/skeleton/my-videos] error", error);
    return send(res, 500, {
      ok: false,
      error: error.message || "Failed to fetch videos",
    });
  }
};
