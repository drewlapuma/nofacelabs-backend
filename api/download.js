// api/download.js (CommonJS, Node 18)
const https = require("https");
const http = require("http");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function safeFilename(name) {
  const base = String(name || "nofacelabs_video")
    .replace(/[^a-z0-9_\-.]/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return base.endsWith(".mp4") ? base : base + ".mp4";
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const url = String(req.query?.url || "").trim();
    const filename = safeFilename(req.query?.filename || "nofacelabs_video.mp4");
    if (!url) return res.status(400).json({ error: "MISSING_URL" });

    let u;
    try { u = new URL(url); } catch { return res.status(400).json({ error: "BAD_URL" }); }

    // only allow http/https
    if (!/^https?:$/.test(u.protocol)) {
      return res.status(400).json({ error: "UNSUPPORTED_PROTOCOL" });
    }

    // Force download
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "video/mp4");

    const lib = u.protocol === "https:" ? https : http;

    const upstream = lib.request(
      {
        method: "GET",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers: {
          "User-Agent": "nofacelabs-download-proxy",
        },
      },
      (up) => {
        // forward status failures
        if (up.statusCode && up.statusCode >= 400) {
          res.statusCode = up.statusCode;
          up.pipe(res);
          return;
        }

        // forward content-length if present
        const len = up.headers["content-length"];
        if (len) res.setHeader("Content-Length", len);

        up.pipe(res);
      }
    );

    upstream.on("error", (e) => {
      console.error("[DOWNLOAD] upstream error", e);
      if (!res.headersSent) res.status(502).json({ error: "UPSTREAM_FAILED" });
      else res.end();
    });

    upstream.end();
  } catch (e) {
    console.error("[DOWNLOAD] error", e);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
};
