// netlify/functions/macro-synthesis.js
// Scheduled function: generates a daily macro intelligence brief using Claude AI
// and stores the result in Supabase `macro_daily_brief`.
//
// Trigger modes:
//   1. Netlify scheduler (Mon-Fri 9am ET) — identified by x-nf-request-id header
//   2. Manual GET with header X-Cron-Secret matching CRON_SECRET env var

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';
const SUPABASE_SERVICE_KEY = process.env.SUPABASESKTradoLux;

const SUPABASE_HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

const SUPABASE_SERVICE_HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'apikey': SUPABASE_SERVICE_KEY,
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Step 2 helpers ────────────────────────────────────────────────────────────

const SPREAD_SCORE = { TIGHT: 10, NORMAL: 6, WIDE: 2 };

function computeMicrostructure(records) {
  const signals_last_30d = records.length;

  // Average spread quality score
  let scoreSum = 0;
  let scoreCount = 0;
  for (const r of records) {
    const s = SPREAD_SCORE[r.spread_quality];
    if (s !== undefined) {
      scoreSum += s;
      scoreCount++;
    }
  }
  const avg_spread_quality_score = scoreCount > 0 ? scoreSum / scoreCount : 6;

  // Accuracy for TIGHT spreads
  const tightRecords = records.filter((r) => r.spread_quality === 'TIGHT');
  let signal_accuracy_tight_spreads_pct = null;
  if (tightRecords.length >= 5) {
    const wins = tightRecords.filter(
      (r) => r.outcome === 'WIN_TP1' || r.outcome === 'WIN_TP2'
    ).length;
    signal_accuracy_tight_spreads_pct = (wins / tightRecords.length) * 100;
  }

  // Accuracy for WIDE spreads
  const wideRecords = records.filter((r) => r.spread_quality === 'WIDE');
  let signal_accuracy_wide_spreads_pct = null;
  if (wideRecords.length >= 5) {
    const wins = wideRecords.filter(
      (r) => r.outcome === 'WIN_TP1' || r.outcome === 'WIN_TP2'
    ).length;
    signal_accuracy_wide_spreads_pct = (wins / wideRecords.length) * 100;
  }

  return {
    signals_last_30d,
    avg_spread_quality_score,
    signal_accuracy_tight_spreads_pct,
    signal_accuracy_wide_spreads_pct,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cron-Secret, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  // Allow if: (a) Netlify scheduler, (b) correct X-Cron-Secret, or (c) admin JWT
  const isNetlifyScheduler = Boolean(event.headers['x-nf-request-id']);
  const cronSecret = process.env.CRON_SECRET;
  const suppliedSecret = event.headers['x-cron-secret'];
  const isAuthorizedManual = cronSecret && suppliedSecret === cronSecret;

  let isAdminJwt = false;
  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!isNetlifyScheduler && !isAuthorizedManual && token) {
    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        const profileRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userData.id}&select=admin`,
          { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } }
        );
        if (profileRes.ok) {
          const profiles = await profileRes.json();
          isAdminJwt = profiles?.[0]?.admin === true;
        }
      }
    } catch {}
  }

  if (!isNetlifyScheduler && !isAuthorizedManual && !isAdminJwt) {
    return {
      statusCode: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized — provide X-Cron-Secret or admin JWT' }),
    };
  }

  // ── Check ANTHROPIC_API_KEY early ──────────────────────────────────────────
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set' }),
    };
  }

  // ── Step 1: Fetch latest macro row ─────────────────────────────────────────
  let macroRow;
  try {
    const macroRes = await fetch(
      `${SUPABASE_URL}/rest/v1/macro_indicators_daily?order=date.desc&limit=1`,
      { headers: SUPABASE_SERVICE_HEADERS }
    );
    if (!macroRes.ok) {
      throw new Error(`Supabase macro_indicators_daily returned HTTP ${macroRes.status}`);
    }
    const rows = await macroRes.json();
    if (!rows || rows.length === 0) {
      throw new Error('No rows found in macro_indicators_daily');
    }
    macroRow = rows[0];
  } catch (err) {
    console.error('[macro-synthesis] Step 1 failed:', err);
    return {
      statusCode: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch macro data', detail: String(err) }),
    };
  }

  // ── Step 2: Fetch microstructure data ─────────────────────────────────────
  let microStats = {
    signals_last_30d: 0,
    avg_spread_quality_score: 6,
    signal_accuracy_tight_spreads_pct: null,
    signal_accuracy_wide_spreads_pct: null,
  };
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const microRes = await fetch(
      `${SUPABASE_URL}/rest/v1/signal_microstructure_log?created_at=gte.${thirtyDaysAgo}&order=created_at.desc&limit=1000`,
      { headers: SUPABASE_SERVICE_HEADERS }
    );
    if (microRes.ok) {
      const records = await microRes.json();
      if (Array.isArray(records)) {
        microStats = computeMicrostructure(records);
      }
    } else {
      console.warn('[macro-synthesis] signal_microstructure_log fetch status:', microRes.status);
    }
  } catch (err) {
    // Non-fatal — use defaults
    console.warn('[macro-synthesis] Step 2 microstructure fetch failed (using defaults):', err);
  }

  // ── Step 3: Call Claude API ────────────────────────────────────────────────
  const today = todayISO();
  const forwardPe = parseFloat(process.env.FORWARD_PE || '21.5');

  const userPromptData = {
    date: today,
    macro: {
      treasury_10y: macroRow.treasury_10y ?? null,
      treasury_2y: macroRow.treasury_2y ?? null,
      yield_curve_spread_bps: macroRow.yield_curve_spread_bps ?? null,
      fed_funds_rate: macroRow.fed_funds_rate ?? null,
      buffett_indicator_pct: macroRow.buffett_indicator_pct ?? null,
      buffett_zone: macroRow.buffett_zone ?? null,
      forward_pe: forwardPe,
      equity_risk_premium_pct: macroRow.equity_risk_premium_pct ?? null,
      dividend_yield_pct: macroRow.sp500_dividend_yield ?? null,
      gold_30d_return_pct: null,
      spy_30d_return_pct: null,
      bitcoin_7d_return_pct: macroRow.bitcoin_usd_7d_change ?? null,
      bitcoin_30d_return_pct: null,
    },
    microstructure: microStats,
  };

  const SYSTEM_PROMPT = `You are a senior macro strategist and market microstructure analyst.
Produce institutional-grade daily market intelligence briefs.
Be direct, precise, and probabilistic. Cite specific indicators.
Never use vague language. Output only valid JSON, no prose, no markdown.`;

  let claudeRaw;
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
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: JSON.stringify(userPromptData, null, 2),
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('[macro-synthesis] Claude API error:', claudeRes.status, errText);
      return {
        statusCode: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Claude API error', status: claudeRes.status, detail: errText }),
      };
    }

    const claudeData = await claudeRes.json();
    claudeRaw = claudeData.content?.[0]?.text || '';
  } catch (err) {
    console.error('[macro-synthesis] Claude fetch threw:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to call Claude API', detail: String(err) }),
    };
  }

  // Parse Claude's JSON response
  let brief;
  try {
    // Strip any accidental markdown fences
    const cleaned = claudeRaw.replace(/```json|```/g, '').trim();
    brief = JSON.parse(cleaned);
  } catch (err) {
    console.error('[macro-synthesis] JSON parse failed. Raw response:', claudeRaw);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Claude response was not valid JSON',
        raw_response: claudeRaw,
      }),
    };
  }

  // ── Step 4: Upsert to Supabase ─────────────────────────────────────────────
  const upsertPayload = {
    trading_date: today,
    generated_at: new Date().toISOString(),
    ...brief,
  };

  try {
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/macro_daily_brief`, {
      method: 'POST',
      headers: {
        ...SUPABASE_SERVICE_HEADERS,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(upsertPayload),
    });
    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('[macro-synthesis] Supabase upsert failed:', upsertRes.status, errText);
      // Non-fatal: log and continue
    }
  } catch (err) {
    // Non-fatal: brief was generated, just log
    console.error('[macro-synthesis] Supabase upsert threw:', err);
  }

  // ── Step 5: Return success ─────────────────────────────────────────────────
  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      date: today,
      market_regime: brief.market_regime,
      macro_regime_score: brief.macro_regime_score,
    }),
  };
};
