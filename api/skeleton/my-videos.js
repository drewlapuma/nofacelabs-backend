const { listJobsByUser } = require("../../lib/skeleton-jobs");

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
