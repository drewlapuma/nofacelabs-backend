// api/_supabase.js (CommonJS) - compatibility wrapper
const { getAdminSupabase } = require("./_lib/supabase");
const supabase = getAdminSupabase();

module.exports = { supabase, getAdminSupabase };
