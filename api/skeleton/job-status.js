const { getJobById } = require("../../lib/skeleton-jobs");

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
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
