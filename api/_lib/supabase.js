const { createClient } = require("@supabase/supabase-js");

function getAdminSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("MISSING_SUPABASE_ENV_VARS");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

module.exports = { getAdminSupabase };
