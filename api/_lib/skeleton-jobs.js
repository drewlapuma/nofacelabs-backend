const crypto = require("crypto");

let supabaseClient = null;
let useSupabase = false;

const memoryJobs = new Map();

function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  const { createClient } = require("@supabase/supabase-js");
  supabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  useSupabase = true;
  return supabaseClient;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = "skjob") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function normalizeJob(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    status: row.status,
    progress: row.progress ?? 0,
    current_step: row.current_step || "",
    script: row.script || "",
    input: row.input || {},
    credits: row.credits || {},
    output: row.output || {},
    error_message: row.error_message || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function createJob(job) {
  const db = getSupabase();
  const row = {
    id: job.id || makeId(),
    user_id: job.user_id || null,
    title: job.title || "Untitled Skeleton Video",
    status: job.status || "queued",
    progress: job.progress ?? 0,
    current_step: job.current_step || "queued",
    script: job.script || "",
    input: job.input || {},
    credits: job.credits || {},
    output: job.output || {},
    error_message: job.error_message || null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  if (db) {
    const { data, error } = await db.from("skeleton_jobs").insert(row).select().single();
    if (error) throw error;
    return normalizeJob(data);
  }

  memoryJobs.set(row.id, row);
  return normalizeJob(row);
}

async function updateJob(id, patch) {
  const db = getSupabase();
  const updatedAt = nowIso();

  if (db) {
    const { data, error } = await db
      .from("skeleton_jobs")
      .update({ ...patch, updated_at: updatedAt })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return normalizeJob(data);
  }

  const existing = memoryJobs.get(id);
  if (!existing) return null;

  const next = { ...existing, ...patch, updated_at: updatedAt };
  memoryJobs.set(id, next);
  return normalizeJob(next);
}

async function getJobById(id) {
  const db = getSupabase();

  if (db) {
    const { data, error } = await db
      .from("skeleton_jobs")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    return normalizeJob(data);
  }

  const row = memoryJobs.get(id);
  return row ? normalizeJob(row) : null;
}

async function listJobsByUser(userId, limit = 50) {
  const db = getSupabase();

  if (db) {
    let query = db
      .from("skeleton_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (userId) query = query.eq("user_id", userId);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalizeJob);
  }

  const rows = Array.from(memoryJobs.values())
    .filter((row) => (userId ? row.user_id === userId : true))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);

  return rows.map(normalizeJob);
}

function startMockProgress(jobId) {
  const steps = [
    { status: "generating_voice", progress: 16, current_step: "Generating voice" },
    { status: "planning_scenes", progress: 32, current_step: "Planning scenes" },
    { status: "generating_images", progress: 54, current_step: "Generating scene images" },
    { status: "animating_scenes", progress: 74, current_step: "Animating scenes" },
    { status: "rendering_final", progress: 90, current_step: "Rendering final video" },
    {
      status: "completed",
      progress: 100,
      current_step: "Completed",
      output: {
        thumbnail_url: "",
        video_url: "",
      },
    },
  ];

  steps.forEach((step, index) => {
    setTimeout(async () => {
      try {
        await updateJob(jobId, step);
      } catch (err) {
        console.error("[skeleton-jobs] mock progress update failed", err);
      }
    }, 2500 * (index + 1));
  });
}

module.exports = {
  createJob,
  updateJob,
  getJobById,
  listJobsByUser,
  startMockProgress,
  makeId,
  getSupabase,
  useSupabase: () => useSupabase,
};
