// netlify/functions/update-agent-weights.js
// Scheduled daily at 6am ET (10:00 UTC Mon-Fri).
// Aggregates 90-day accuracy per condition_key, auto-applies or queues weight changes.
// Also writes agent_performance_daily summary rows.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASESKTradoLux;

const APPROVAL_THRESHOLD = 0.20; // changes >= 20% require admin approval
const MIN_SAMPLES = 10;
const AGENTS = ['momentum', 'macro', 'microstructure', 'contrarian', 'composite'];

function sbHeaders(key) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
    'apikey': key,
  };
}

exports.handler = async (event) => {
  const isScheduler = Boolean(event.headers['x-nf-request-id']);
  const secret = event.headers['x-cron-secret'] || '';
  if (!isScheduler && secret !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  if (!SUPABASE_SERVICE_KEY) return { statusCode: 500, body: 'SUPABASE_SERVICE_KEY not set' };

  const SB = sbHeaders(SUPABASE_SERVICE_KEY);
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString();

  // Step 1: Fetch last 90 days of evaluated signals with condition_key
  const outcomesUrl = `${SUPABASE_URL}/rest/v1/signal_microstructure_log` +
    `?is_evaluated=eq.true` +
    `&created_at=gte.${encodeURIComponent(since90)}` +
    `&condition_key=not.is.null` +
    `&select=condition_key,outcome_direction,outcome_hit_target,agent_name` +
    `&limit=10000`;

  const outcomesRes = await fetch(outcomesUrl, { headers: SB });
  if (!outcomesRes.ok) {
    console.error('[weights] fetch outcomes failed:', await outcomesRes.text());
    return { statusCode: 500, body: 'Failed to fetch outcomes' };
  }
  const outcomes = await outcomesRes.json();
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ autoApplied: 0, queued: 0, agentRows: 0 }) };
  }

  // Step 2: Group by condition_key
  const groups = {};
  for (const row of outcomes) {
    const key = row.condition_key;
    if (!key) continue;
    if (!groups[key]) groups[key] = { correct: 0, total: 0, targetHits: 0 };
    groups[key].total++;
    if (row.outcome_direction === 'correct') groups[key].correct++;
    if (row.outcome_hit_target) groups[key].targetHits++;
  }

  // Step 3: Fetch existing weights as a map
  const weightsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/learned_weights?select=condition_key,weight_multiplier`,
    { headers: SB }
  );
  const existingRaw = weightsRes.ok ? await weightsRes.json() : [];
  const weightMap = {};
  for (const w of (Array.isArray(existingRaw) ? existingRaw : [])) {
    weightMap[w.condition_key] = parseFloat(w.weight_multiplier) || 1.0;
  }

  let autoApplied = 0, queued = 0;

  // Step 4: Compute and upsert per condition_key
  for (const [key, stats] of Object.entries(groups)) {
    if (stats.total < MIN_SAMPLES) continue;

    const accuracy  = stats.correct / stats.total;
    // Scale: 0% accuracy → 0.1; 50% baseline → 1.0; 100% → 2.0 (capped at 3.0)
    const newWeight = parseFloat(Math.max(0.1, Math.min(3.0, accuracy / 0.5)).toFixed(4));
    const oldWeight = weightMap[key] || 1.0;
    const changePct = Math.abs((newWeight - oldWeight) / oldWeight);

    const explanation =
      `Accuracy: ${(accuracy * 100).toFixed(1)}% over ${stats.total} signals. ` +
      `Target hit rate: ${(stats.targetHits / stats.total * 100).toFixed(1)}%.`;

    if (changePct < APPROVAL_THRESHOLD) {
      await sbUpsert('learned_weights', {
        condition_key:       key,
        weight_multiplier:   newWeight,
        accuracy_rate:       parseFloat((accuracy * 100).toFixed(2)),
        sample_size:         stats.total,
        explanation,
        approved:            true,
        updated_at:          new Date().toISOString(),
        pending_weight:      null,
        pending_accuracy:    null,
        pending_samples:     null,
        pending_explanation: null,
        pending_created_at:  null,
      }, SB);
      autoApplied++;
    } else {
      // Queue for admin — do NOT overwrite the current live weight
      await sbUpsert('learned_weights', {
        condition_key:       key,
        pending_weight:      newWeight,
        pending_accuracy:    parseFloat((accuracy * 100).toFixed(2)),
        pending_samples:     stats.total,
        pending_explanation: explanation,
        pending_created_at:  new Date().toISOString(),
      }, SB);
      queued++;
    }
  }

  // Step 5: Write agent performance daily summaries
  const agentRows = await computeAgentPerformance(since90, SB);

  return {
    statusCode: 200,
    body: JSON.stringify({ autoApplied, queued, agentRows }),
  };
};

async function sbUpsert(table, body, headers) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}`,
    {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) console.warn(`[weights] upsert ${table} failed:`, await res.text());
}

async function computeAgentPerformance(since, SB) {
  const today = new Date().toISOString().slice(0, 10);
  let written = 0;

  for (const agent of AGENTS) {
    const url = `${SUPABASE_URL}/rest/v1/signal_microstructure_log` +
      `?is_evaluated=eq.true` +
      `&agent_name=eq.${encodeURIComponent(agent)}` +
      `&created_at=gte.${encodeURIComponent(since)}` +
      `&select=outcome_direction,outcome_hit_target,outcome_rr,outcome_pnl_pct,condition_key` +
      `&limit=5000`;

    const res = await fetch(url, { headers: SB });
    if (!res.ok) continue;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) continue;

    const total      = data.length;
    const correct    = data.filter(r => r.outcome_direction === 'correct').length;
    const targetHits = data.filter(r => r.outcome_hit_target).length;
    const avgRR  = data.reduce((s, r) => s + (r.outcome_rr || 0), 0) / total;
    const avgPnl = data.reduce((s, r) => s + (r.outcome_pnl_pct || 0), 0) / total;

    // Best/worst condition by direction win rate (min 3 samples)
    const condMap = {};
    for (const r of data) {
      const k = r.condition_key;
      if (!k) continue;
      if (!condMap[k]) condMap[k] = { correct: 0, total: 0 };
      condMap[k].total++;
      if (r.outcome_direction === 'correct') condMap[k].correct++;
    }
    const condRates = Object.entries(condMap)
      .filter(([, v]) => v.total >= 3)
      .map(([k, v]) => ({ k, rate: v.correct / v.total }))
      .sort((a, b) => b.rate - a.rate);

    await sbUpsert('agent_performance_daily', {
      agent_name:         agent,
      date:               today,
      signals_count:      total,
      direction_win_rate: parseFloat((correct / total).toFixed(4)),
      rr_win_rate:        parseFloat((targetHits / total).toFixed(4)),
      avg_rr:             parseFloat(avgRR.toFixed(4)),
      avg_pnl_pct:        parseFloat(avgPnl.toFixed(4)),
      best_condition:     condRates[0]?.k || null,
      worst_condition:    condRates[condRates.length - 1]?.k || null,
    }, SB);
    written++;
  }
  return written;
}
