// lib/credits.js
// CommonJS

const IMAGE_CREDIT_COSTS = {
  "nano-banana": 2,
  "imagen-4-fast": 3,
  "flux-2-flex": 4,
  "imagen-4": 5,
  "nano-banana-pro": 6,
  "flux-2-pro": 7,
  "imagen-4-ultra": 8,
  "flux-2-max": 10,
  "grok-image": 8
};

const CREDIT_PACKS = {
  starter_5: { dollars: 5, credits: 100 },
  creator_30: { dollars: 30, credits: 700 },
  pro_75: { dollars: 75, credits: 2000 }
};

function getImageCredits(model) {
  const cost = IMAGE_CREDIT_COSTS[model];
  if (!cost) throw new Error(`Unknown image model: ${model}`);
  return cost;
}

function getVideoCredits({ model, durationSeconds, resolution }) {
  const baseMap = {
    "sora-2": 15,
    "sora-2-pro": 55,
    "veo-3-fast": 30,
    "veo-3.1-fast": 30,
    "veo-3": 75,
    "veo-3.1": 75,
    "grok-imagine-video": 80
  };

  const durationMult = {
    5: 1.0,
    8: 1.6,
    10: 2.0
  };

  const resolutionMult = {
    "720p": 1.0,
    "1080p": 1.5,
    "4k": 2.5
  };

  if (model === "sora-2-pro" && resolution === "1080p") {
    if (Number(durationSeconds) === 5) return 95;
    if (Number(durationSeconds) === 8) return 150;
    if (Number(durationSeconds) === 10) return 190;
  }

  const base = baseMap[model];
  if (!base) throw new Error(`Unknown video model: ${model}`);

  const d = durationMult[Number(durationSeconds)] || 1.0;
  const r = resolutionMult[resolution] || 1.0;

  return Math.ceil(base * d * r);
}

async function ensureUserCreditsRow(supabaseAdmin, memberId) {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("user_credits")
    .select("member_id")
    .eq("member_id", memberId)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);

  if (!existing) {
    const { error: insertError } = await supabaseAdmin
      .from("user_credits")
      .insert({
        member_id: memberId,
        balance: 0,
        lifetime_purchased: 0,
        lifetime_used: 0
      });

    if (insertError) throw new Error(insertError.message);
  }
}

async function getCreditBalance(supabaseAdmin, memberId) {
  await ensureUserCreditsRow(supabaseAdmin, memberId);

  const { data, error } = await supabaseAdmin
    .from("user_credits")
    .select("balance,lifetime_purchased,lifetime_used")
    .eq("member_id", memberId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function deductCredits({
  supabaseAdmin,
  memberId,
  amount,
  reason,
  toolType,
  model,
  jobId,
  metadata = {}
}) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Credit deduction amount must be a positive integer");
  }

  await ensureUserCreditsRow(supabaseAdmin, memberId);

  const { data: row, error: fetchError } = await supabaseAdmin
    .from("user_credits")
    .select("balance,lifetime_used")
    .eq("member_id", memberId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  const currentBalance = Number(row.balance || 0);
  if (currentBalance < amount) {
    const err = new Error("Not enough credits");
    err.code = "INSUFFICIENT_CREDITS";
    err.balance = currentBalance;
    err.required = amount;
    throw err;
  }

  const newBalance = currentBalance - amount;

  const { error: updateError } = await supabaseAdmin
    .from("user_credits")
    .update({
      balance: newBalance,
      lifetime_used: Number(row.lifetime_used || 0) + amount,
      updated_at: new Date().toISOString()
    })
    .eq("member_id", memberId);

  if (updateError) throw new Error(updateError.message);

  const { error: ledgerError } = await supabaseAdmin
    .from("credit_ledger")
    .insert({
      member_id: memberId,
      delta: -amount,
      balance_after: newBalance,
      reason,
      tool_type: toolType || null,
      model: model || null,
      job_id: jobId || null,
      metadata
    });

  if (ledgerError) throw new Error(ledgerError.message);

  return { balanceAfter: newBalance };
}

async function addCredits({
  supabaseAdmin,
  memberId,
  amount,
  reason,
  toolType,
  model,
  jobId,
  metadata = {},
  countsAsPurchase = false
}) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Credit add amount must be a positive integer");
  }

  await ensureUserCreditsRow(supabaseAdmin, memberId);

  const { data: row, error: fetchError } = await supabaseAdmin
    .from("user_credits")
    .select("balance,lifetime_purchased")
    .eq("member_id", memberId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  const newBalance = Number(row.balance || 0) + amount;
  const newLifetimePurchased = countsAsPurchase
    ? Number(row.lifetime_purchased || 0) + amount
    : Number(row.lifetime_purchased || 0);

  const { error: updateError } = await supabaseAdmin
    .from("user_credits")
    .update({
      balance: newBalance,
      lifetime_purchased: newLifetimePurchased,
      updated_at: new Date().toISOString()
    })
    .eq("member_id", memberId);

  if (updateError) throw new Error(updateError.message);

  const { error: ledgerError } = await supabaseAdmin
    .from("credit_ledger")
    .insert({
      member_id: memberId,
      delta: amount,
      balance_after: newBalance,
      reason,
      tool_type: toolType || null,
      model: model || null,
      job_id: jobId || null,
      metadata
    });

  if (ledgerError) throw new Error(ledgerError.message);

  return { balanceAfter: newBalance };
}

module.exports = {
  CREDIT_PACKS,
  IMAGE_CREDIT_COSTS,
  getImageCredits,
  getVideoCredits,
  getCreditBalance,
  deductCredits,
  addCredits
};
