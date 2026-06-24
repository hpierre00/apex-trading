/**
 * macro-synthesis.js
 * Runs daily at 1pm ET (Mon-Fri).
 * 1. Fetches key macro indicators from Polygon (VIX, SPY, TLT, GLD, BTC)
 * 2. Carries forward slow-moving indicators (Fed Funds, Buffett) from last stored row
 * 3. Calls Claude to synthesize a macro brief
 * 4. Writes key-value rows to macro_indicators_daily + brief to macro_daily_brief
 */

import { createClient } from '@supabase/supabase-js';

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const POLY_KEY   = process.env.POLYGON_API_KEY;
const ANTH_KEY   = process.env.ANTHROPIC_API_KEY;

// ── Market data helpers ───────────────────────────────────────────────────────

async function polyPrevClose(ticker) {
  if (!POLY_KEY) return null;
  try {
    const r = await fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLY_KEY}`);
    const d = await r.json();
    return d.results?.[0] || null;
  } catch { return null; }
}

async function polyIndexClose(indexTicker) {
  if (!POLY_KEY) return null;
  try {
    const r = await fetch(`https://api.polygon.io/v3/snapshot?ticker.any_of=${indexTicker}&apiKey=${POLY_KEY}`);
    const d = await r.json();
    return d.results?.[0]?.session?.close || d.results?.[0]?.prevDay?.close || null;
  } catch { return null; }
}

// ── Load last stored indicator values (for carry-forward) ────────────────────

async function getLastIndicators() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('macro_indicators_daily')
    .select('indicator_name,value,zone')
    .gte('date', sevenDaysAgo)
    .order('date', { ascending: false });
  if (!data?.length) return {};
  // Pivot: take most recent value per indicator_name
  const map = {};
  data.forEach(r => { if (!(r.indicator_name in map)) map[r.indicator_name] = { value: r.value, zone: r.zone }; });
  return map;
}

// ── Compute macro regime score (0-100) ───────────────────────────────────────

function computeRegime(indicators) {
  const { vix_level, yield_curve_spread_bps, buffett_indicator_pct, equity_risk_premium_pct } = indicators;
  let score = 50;
  const vix = vix_level?.value ?? null;
  const yld = yield_curve_spread_bps?.value ?? null;
  const buf = buffett_indicator_pct?.value ?? null;
  const erp = equity_risk_premium_pct?.value ?? null;

  if (vix !== null) {
    if (vix < 15) score += 15;
    else if (vix < 20) score += 8;
    else if (vix > 30) score -= 20;
    else if (vix > 25) score -= 10;
  }
  if (yld !== null) {
    if (yld > 50)  score += 10;
    else if (yld < 0) score -= 15;
  }
  if (buf !== null) {
    if (buf > 175) score -= 15;
    else if (buf > 145) score -= 8;
    else if (buf < 100) score += 10;
  }
  if (erp !== null) {
    if (erp > 2) score += 10;
    else if (erp < 0) score -= 15;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function handler() {
  const today = new Date().toISOString().slice(0, 10);
  const now   = new Date().toISOString();
  console.log('[macro-synthesis] Starting for', today);

  // Skip if already ran today
  const { data: existing } = await supabase
    .from('macro_daily_brief')
    .select('id')
    .eq('trading_date', today)
    .single();
  if (existing) {
    console.log('[macro-synthesis] Already ran today, skipping');
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
  }

  // ── Fetch market data in parallel ─────────────────────────────────────────
  const [vixVal, spyData, gldData, btcData, tltData, qqqData, last] = await Promise.allSettled([
    polyIndexClose('I:VIX'),
    polyPrevClose('SPY'),
    polyPrevClose('GLD'),
    polyPrevClose('X:BTCUSD'),
    polyPrevClose('TLT'),
    polyPrevClose('QQQ'),
    getLastIndicators(),
  ]);

  const vix  = vixVal.status  === 'fulfilled' ? vixVal.value  : null;
  const spy  = spyData.status === 'fulfilled' ? spyData.value : null;
  const gld  = gldData.status === 'fulfilled' ? gldData.value : null;
  const btc  = btcData.status === 'fulfilled' ? btcData.value : null;
  const tlt  = tltData.status === 'fulfilled' ? tltData.value : null;
  const qqq  = qqqData.status === 'fulfilled' ? qqqData.value : null;
  const prev = last.status    === 'fulfilled' ? last.value    : {};

  // Carry forward slow-moving indicators; fall back to reasonable defaults
  const treasury10y  = prev.treasury_10y?.value          ?? 4.35;
  const fedFunds     = prev.fed_funds_rate?.value         ?? 5.33;
  const yieldCurve   = prev.yield_curve_spread_bps?.value ?? -25;
  const buffettPct   = prev.buffett_indicator_pct?.value  ?? 197;
  const spDivYield   = prev.sp500_dividend_yield?.value   ?? 1.35;
  const forwardPe    = prev.forward_pe?.value              ?? 21.5;
  const erp          = prev.equity_risk_premium_pct?.value ?? ((1 / forwardPe * 100) - treasury10y);
  const buffettZone  = buffettPct > 175 ? 'EXTREME' : buffettPct > 145 ? 'OVERVALUED' : buffettPct > 115 ? 'ELEVATED' : 'FAIR';

  const goldPrice  = gld?.c  || null;
  const btcClose   = btc?.c  || null;
  const btcPrev    = prev.bitcoin_usd?.value ?? null;
  const btcChange7d = (btcClose && btcPrev) ? +((btcClose - btcPrev) / btcPrev * 100).toFixed(2) : null;
  const spyClose   = spy?.c  || null;
  const qqqClose   = qqq?.c  || null;
  const vixLevel   = typeof vix === 'number' ? vix : null;

  // Build named indicator map for regime calc
  const indicatorMap = {
    vix_level:                { value: vixLevel,    zone: vixLevel === null ? null : vixLevel < 15 ? 'LOW' : vixLevel < 20 ? 'NORMAL' : vixLevel < 30 ? 'ELEVATED' : 'EXTREME' },
    treasury_10y:             { value: treasury10y, zone: treasury10y < 3 ? 'EASY' : treasury10y < 4.5 ? 'NORMAL' : 'RESTRICTIVE' },
    fed_funds_rate:           { value: fedFunds,    zone: 'POLICY_RATE' },
    yield_curve_spread_bps:   { value: yieldCurve,  zone: yieldCurve < 0 ? 'INVERTED' : yieldCurve < 50 ? 'FLAT' : 'NORMAL' },
    buffett_indicator_pct:    { value: buffettPct,  zone: buffettZone },
    sp500_dividend_yield:     { value: spDivYield,  zone: spDivYield > treasury10y ? 'STOCKS_BETTER' : 'BONDS_BETTER' },
    forward_pe:               { value: forwardPe,   zone: forwardPe > 25 ? 'EXPENSIVE' : forwardPe > 20 ? 'ELEVATED' : 'FAIR' },
    equity_risk_premium_pct:  { value: +erp.toFixed(2), zone: erp > 0 ? 'EQ_COMPETITIVE' : 'BONDS_BETTER' },
    gold_price:               { value: goldPrice,   zone: null },
    bitcoin_usd:              { value: btcClose,    zone: null },
    bitcoin_usd_7d_change:    { value: btcChange7d, zone: null },
    spy_close:                { value: spyClose,    zone: null },
    qqq_close:                { value: qqqClose,    zone: null },
  };

  const regime   = computeRegime(indicatorMap);
  const signalAdj = regime >= 65 ? 10 : regime >= 50 ? 0 : regime >= 35 ? -10 : -20;

  // ── Insert key-value rows into macro_indicators_daily ─────────────────────
  const indicatorRows = Object.entries(indicatorMap)
    .filter(([, v]) => v.value !== null && v.value !== undefined)
    .map(([name, v]) => ({
      date: today,
      indicator_name: name,
      value: v.value,
      zone: v.zone || null,
    }));

  if (indicatorRows.length) {
    const { error: indErr } = await supabase
      .from('macro_indicators_daily')
      .upsert(indicatorRows, { onConflict: 'date,indicator_name' });
    if (indErr) console.error('[macro-synthesis] indicator insert error:', indErr.message);
  }

  // ── Generate AI brief ─────────────────────────────────────────────────────
  const context = {
    date: today,
    vix: vixLevel,
    treasury_10y: treasury10y,
    fed_funds: fedFunds,
    yield_curve_bps: yieldCurve,
    buffett_pct: buffettPct,
    buffett_zone: buffettZone,
    forward_pe: forwardPe,
    equity_risk_premium_pct: +erp.toFixed(2),
    sp500_dividend_yield: spDivYield,
    gold_price: goldPrice,
    btc_close: btcClose,
    btc_7d_change_pct: btcChange7d,
    spy_close: spyClose,
    regime_score: regime,
    signal_adj_pct: signalAdj,
  };

  const marketRegime = regime >= 65 ? 'BULL' : regime >= 50 ? 'NEUTRAL-BULL' : regime >= 35 ? 'NEUTRAL-BEAR' : 'BEAR';
  const valuationAss = buffettPct > 175 ? 'EXTREME OVERVALUATION' : buffettPct > 145 ? 'OVERVALUED' : buffettPct > 115 ? 'ELEVATED' : 'FAIR';

  if (!ANTH_KEY) {
    // Write minimal brief without AI
    await supabase.from('macro_daily_brief').upsert({
      trading_date: today,
      macro_headline: `Regime score ${regime}/100 — ${marketRegime} | VIX: ${vixLevel ?? '—'}`,
      market_regime: marketRegime,
      valuation_assessment: valuationAss,
      macro_regime_score: regime,
      signal_confidence_adjustment: signalAdj,
      raw_indicators: context,
      generated_at: now,
    }, { onConflict: 'trading_date' });
    return { statusCode: 200, body: JSON.stringify({ ok: true, regime, ai: false }) };
  }

  const prompt = `You are the macro analyst for Tradolux, an AI-powered day-trading platform. Today is ${today}.

Current macro indicators:
${JSON.stringify(context, null, 2)}

Generate a concise macro market brief for day traders. Return ONLY valid JSON:
{
  "macro_headline": "<15-word max headline summarising today's macro backdrop>",
  "full_brief": "<2-3 paragraphs covering macro regime, key risks, and opportunities for day traders today>",
  "key_risks": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "key_supports": ["<support 1>", "<support 2>"],
  "best_trade_window": "<e.g. '10:30-11:30 ET — post-open momentum'>",
  "avoid_window": "<e.g. '12:00-13:00 ET — lunch chop'>",
  "execution_quality_today": "<GOOD|MODERATE|POOR>"
}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTH_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    const rawText = aiData.content?.[0]?.text || '{}';
    let brief = {};
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      brief = match ? JSON.parse(match[0]) : {};
    } catch { brief = {}; }

    const { error: briefErr } = await supabase.from('macro_daily_brief').upsert({
      trading_date: today,
      macro_headline:              brief.macro_headline || `Regime ${regime}/100 — VIX ${vixLevel ?? '—'}`,
      full_brief:                  brief.full_brief || null,
      key_risks:                   brief.key_risks  || [],
      key_supports:                brief.key_supports || [],
      best_trade_window:           brief.best_trade_window || null,
      avoid_window:                brief.avoid_window || null,
      execution_quality_today:     brief.execution_quality_today || null,
      market_regime:               marketRegime,
      valuation_assessment:        valuationAss,
      macro_regime_score:          regime,
      signal_confidence_adjustment: signalAdj,
      raw_indicators:              context,
      generated_at:                now,
    }, { onConflict: 'trading_date' });

    if (briefErr) console.error('[macro-synthesis] brief error:', briefErr.message);

    console.log(`[macro-synthesis] Done — regime: ${regime}, VIX: ${vixLevel}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, regime, vix: vixLevel, date: today }) };

  } catch (err) {
    console.error('[macro-synthesis] AI failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
