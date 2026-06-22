// Netlify Function: learning-agent
// Weekly cron (Sun 8pm ET = Mon 00:00 UTC) — analyzes signal outcomes and
// upserts learned weight multipliers per market condition group to learned_weights.
// Manual trigger: POST with X-Cron-Secret header.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';
const SUPABASE_SERVICE_KEY = process.env.SUPABASESKTradoLux;

const SUPABASE_SERVICE_HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'apikey': SUPABASE_SERVICE_KEY,
};

function getMacroBucket(score) {
  if (score === null || score === undefined) return 'NEUTRAL';
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'ELEVATED';
  if (score >= 25) return 'NEUTRAL';
  return 'LOW';
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cron-Secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  // ── Auth: X-Cron-Secret or Netlify scheduler ──────────────────────────────
  const isScheduler = Boolean(event.headers['x-nf-request-id']);
  const secret = event.headers['x-cron-secret'] || '';
  if (!isScheduler && secret !== process.env.CRON_SECRET) {
    return {
      statusCode: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }),
    };
  }

  // ── Step 1: Fetch last 90 days of resolved signals ─────────────────────────
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  let signals = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/signal_microstructure_log?created_at=gte.${ninetyDaysAgo}&is_evaluated=eq.true&order=created_at.desc&limit=5000`,
      { headers: SUPABASE_SERVICE_HEADERS }
    );
    if (!res.ok) throw new Error(`Supabase returned ${res.status}`);
    const data = await res.json();
    signals = Array.isArray(data) ? data : [];
  } catch (err) {
    return {
      statusCode: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch signal log', detail: String(err) }),
    };
  }

  if (signals.length === 0) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, groupsAnalyzed: 0, message: 'No resolved signals yet' }),
    };
  }

  // ── Step 2: Group by condition_key ─────────────────────────────────────────
  const groups = {};
  for (const s of signals) {
    const macroBucket = getMacroBucket(s.macro_regime_score);
    const spreadLabel = s.spread_quality_label || s.spread_quality || 'NORMAL';
    const timeBucket = s.time_of_day_bucket?.slice(0, 5) || s.time_bucket || '09:30';
    const key = `${macroBucket}_${spreadLabel}_${timeBucket}`;
    if (!groups[key]) groups[key] = { wins: 0, total: 0, confidence_sum: 0 };
    groups[key].total++;
    if (s.outcome_direction === 'correct') groups[key].wins++;
    groups[key].confidence_sum += s.confidence_score || s.confidence || 50;
  }

  // Filter: minimum 10 signals per group
  const meaningful = Object.entries(groups)
    .filter(([, g]) => g.total >= 10)
    .map(([key, g]) => ({
      condition_key: key,
      accuracy_rate: parseFloat(((g.wins / g.total) * 100).toFixed(1)),
      sample_size: g.total,
      avg_confidence: parseFloat((g.confidence_sum / g.total).toFixed(1)),
    }));

  if (meaningful.length === 0) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, groupsAnalyzed: 0, message: 'Insufficient samples per group (need >=10)' }),
    };
  }

  // ── Step 3: Call Claude to compute weight multipliers ─────────────────────
  const claudePrompt = `You are a quantitative trading signal analyst. Given these signal outcome groups from a trading platform, analyze performance by market condition.

For each condition_key with sample_size >= 10, determine a weight_multiplier between 0.3 and 1.8 that should be applied to signal confidence in those conditions going forward.

A weight of 1.0 means no change. Higher accuracy warrants higher weight; lower accuracy warrants lower weight. Calibrate aggressively — a 90% accuracy condition should get weight ~1.5-1.8; a 30% accuracy condition should get weight ~0.3-0.5.

Input data:
${JSON.stringify(meaningful, null, 2)}

Return a JSON array only, no prose, no markdown, no explanation outside the array. Each element must have exactly these fields:
{ "condition_key": string, "weight_multiplier": number, "accuracy_rate": number, "sample_size": number, "explanation": string }`;

  let weightResults = [];
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: 'You are a quantitative trading analyst. Output only valid JSON arrays, no prose, no markdown.',
        messages: [{ role: 'user', content: claudePrompt }],
      }),
    });
    if (!claudeRes.ok) throw new Error(`Claude API returned ${claudeRes.status}`);
    const claudeData = await claudeRes.json();
    let rawText = claudeData.content?.[0]?.text || '';
    // Strip markdown fences if present
    rawText = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    weightResults = JSON.parse(rawText);
    if (!Array.isArray(weightResults)) throw new Error('Claude response is not an array');
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Claude API failed', detail: String(err) }),
    };
  }

  // ── Step 4: Upsert to learned_weights (approved = false) ──────────────────
  let upsertCount = 0;
  for (const row of weightResults) {
    if (!row.condition_key || typeof row.weight_multiplier !== 'number') continue;
    // Clamp weight to valid range
    row.weight_multiplier = Math.max(0.3, Math.min(1.8, row.weight_multiplier));
    try {
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/learned_weights`, {
        method: 'POST',
        headers: { ...SUPABASE_SERVICE_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          condition_key: row.condition_key,
          weight_multiplier: row.weight_multiplier,
          accuracy_rate: row.accuracy_rate,
          sample_size: row.sample_size,
          explanation: row.explanation || '',
          approved: false,
          updated_at: new Date().toISOString(),
        }),
      });
      if (upsertRes.ok) upsertCount++;
      else console.warn('[learning-agent] upsert failed for', row.condition_key, await upsertRes.text());
    } catch (err) {
      console.error('[learning-agent] upsert error:', err);
    }
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, groupsAnalyzed: meaningful.length, weightsUpserted: upsertCount }),
  };
};
