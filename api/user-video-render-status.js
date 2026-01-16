// api/user-video-render-status.js
const https = require("https");

function json(res, status, body){
  res.statusCode = status;
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req,res){
  if (req.method !== "GET") return json(res,405,{error:"Method not allowed"});

  const id = (req.query?.id || new URL(req.url, "http://x").searchParams.get("id") || "").trim();
  if (!id) return json(res,400,{error:"Missing id"});

  const key = process.env.CREATOMATE_API_KEY;
  if (!key) return json(res,500,{error:"Missing CREATOMATE_API_KEY"});

  const url = `https://api.creatomate.com/v1/renders/${encodeURIComponent(id)}`;

  const data = await new Promise((resolve,reject)=>{
    const u = new URL(url);
    const r = https.request({
      method:"GET",
      hostname:u.hostname,
      path:u.pathname + u.search,
      headers:{ Authorization:`Bearer ${key}` }
    }, (resp)=>{
      let s=""; resp.on("data",c=>s+=c);
      resp.on("end",()=>{
        try{ resolve(JSON.parse(s)); } catch { resolve(null); }
      });
    });
    r.on("error",reject);
    r.end();
  });

  if (!data) return json(res,500,{error:"Bad response from Creatomate"});

  const status = data.status; // "planned" | "processing" | "succeeded" | "failed"
  if (status === "succeeded") return json(res,200,{status:"succeeded", url:data.url});
  if (status === "failed") return json(res,200,{status:"failed", error:data.error || "Render failed"});
  return json(res,200,{status: status || "processing"});
};
