const { getJobById } = require("../_lib/skeleton-jobs");

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

    const jobId = String(req.query?.jobId || "").trim();
    if (!jobId) {
      return send(res, 400, { ok: false, error: "Missing jobId" });
    }

    const job = await getJobById(jobId);
    if (!job) {
      return send(res, 404, { ok: false, error: "Job not found" });
    }

    return send(res, 200, {
      ok: true,
      job,
    });
  } catch (error) {
    console.error("[api/skeleton/job-status] error", error);
    return send(res, 500, {
      ok: false,
      error: error.message || "Failed to fetch job status",
    });
  }
};
