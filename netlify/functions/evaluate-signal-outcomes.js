// netlify/functions/evaluate-signal-outcomes.js
// Scheduled every 30 min during market hours (Mon-Fri 9:30-17:00 ET).
// Fetches signals whose eval window has passed, pulls Polygon bars, scores outcome.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASESKTradoLux;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

const TF_MINUTES = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '4h': 240, '1d': 1440, '1w': 10080,
};

// Max bars per timespan: intraday needs up to 390 (1m × full day), daily/weekly need far fewer
const POLY_LIMIT = 500;

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
  if (!POLYGON_API_KEY)      return { statusCode: 500, body: 'POLYGON_API_KEY not set' };

  const SB = sbHeaders(SUPABASE_SERVICE_KEY);
  const now = new Date();
  const nowISO = now.toISOString();

  // Fetch up to 100 signals ready for evaluation
  const fetchUrl = `${SUPABASE_URL}/rest/v1/signal_microstructure_log` +
    `?is_evaluated=eq.false` +
    `&eval_after_ts=not.is.null` +
    `&eval_after_ts=lte.${encodeURIComponent(nowISO)}` +
    `&select=*&limit=100&order=eval_after_ts.asc`;

  const fetchRes = await fetch(fetchUrl, { headers: SB });
  if (!fetchRes.ok) {
    console.error('[evaluate] fetch signals failed:', await fetchRes.text());
    return { statusCode: 500, body: 'Failed to fetch signals' };
  }
  const signals = await fetchRes.json();
  if (!Array.isArray(signals) || signals.length === 0) {
    return { statusCode: 200, body: 'nothing to evaluate' };
  }

  let evaluated = 0;

  for (const sig of signals) {
    try {
      if (!sig.symbol) {
        console.warn('[evaluate] skipping signal with no symbol:', sig.id);
        await markEvaluated(sig.id, { is_evaluated: true, outcome_evaluated_at: nowISO }, SB);
        continue;
      }

      const tfMins = TF_MINUTES[sig.timeframe] || 5;
      const from   = new Date(sig.created_at);
      const to     = new Date(sig.eval_after_ts);

      // Choose Polygon timespan — week must be checked before day (10080 > 1440)
      let timespan = 'minute';
      let multiplier = tfMins;
      if (tfMins >= 10080)     { timespan = 'week'; multiplier = 1; }
      else if (tfMins >= 1440) { timespan = 'day';  multiplier = Math.round(tfMins / 1440); }

      const fromDate = from.toISOString().slice(0, 10);
      const toDate   = to.toISOString().slice(0, 10);
      const polyUrl  = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(sig.symbol)}/range/${multiplier}/${timespan}/${fromDate}/${toDate}` +
                       `?apiKey=${POLYGON_API_KEY}&limit=${POLY_LIMIT}&sort=asc&adjusted=true`;

      const polyRes = await fetch(polyUrl);

      // 429 rate-limit: do NOT mark evaluated — let it retry on next cron run
      if (polyRes.status === 429) {
        console.warn(`[evaluate] Polygon rate-limited for ${sig.symbol}, will retry`);
        continue;
      }

      if (!polyRes.ok) {
        console.warn(`[evaluate] Polygon ${sig.symbol} returned ${polyRes.status}`);
        await markEvaluated(sig.id, { is_evaluated: true, outcome_evaluated_at: nowISO }, SB);
        continue;
      }

      const polyData = await polyRes.json();
      const bars = Array.isArray(polyData.results) ? polyData.results : [];

      if (bars.length === 0) {
        await markEvaluated(sig.id, { is_evaluated: true, outcome_evaluated_at: nowISO }, SB);
        continue;
      }

      // Resolve direction — DB column is signal_direction, fallback for older rows
      const rawDir = (sig.signal_direction || sig.direction || '').toUpperCase();
      if (rawDir !== 'BUY' && rawDir !== 'SELL') {
        console.warn(`[evaluate] unknown direction "${rawDir}" for signal ${sig.id}, skipping`);
        await markEvaluated(sig.id, { is_evaluated: true, outcome_evaluated_at: nowISO }, SB);
        continue;
      }
      const direction = rawDir === 'BUY' ? 1 : -1;

      const entry = sig.entry_price || bars[0].o;
      if (!entry) {
        console.warn(`[evaluate] no entry price for signal ${sig.id}, skipping`);
        await markEvaluated(sig.id, { is_evaluated: true, outcome_evaluated_at: nowISO }, SB);
        continue;
      }
      const stop   = sig.stop_price   || entry * (1 - direction * 0.015);
      const target = sig.target_price || entry * (1 + direction * 0.025);

      let hitTarget = false, hitStop = false, exitPrice = bars[bars.length - 1].c;

      for (const bar of bars) {
        if (direction === 1) {
          if (bar.h >= target) { hitTarget = true; exitPrice = target; break; }
          if (bar.l <= stop)   { hitStop   = true; exitPrice = stop;   break; }
        } else {
          if (bar.l <= target) { hitTarget = true; exitPrice = target; break; }
          if (bar.h >= stop)   { hitStop   = true; exitPrice = stop;   break; }
        }
      }

      const pnlPct  = ((exitPrice - entry) / entry) * direction * 100;
      const riskPct = Math.abs((stop - entry) / entry * 100);
      const rr      = riskPct > 0 ? parseFloat((pnlPct / riskPct).toFixed(3)) : 0;
      const outcomeDirection =
        pnlPct > 0.05  ? 'correct' :
        pnlPct < -0.05 ? 'incorrect' : 'neutral';

      await markEvaluated(sig.id, {
        is_evaluated:         true,
        outcome_direction:    outcomeDirection,
        outcome_hit_target:   hitTarget,
        outcome_hit_stop:     hitStop,
        outcome_exit_price:   parseFloat(exitPrice.toFixed(4)),
        outcome_pnl_pct:      parseFloat(pnlPct.toFixed(4)),
        outcome_rr:           rr,
        outcome_evaluated_at: nowISO,
      }, SB);
      evaluated++;
    } catch (err) {
      console.error('[evaluate] error for signal', sig.id, err);
    }
  }

  return { statusCode: 200, body: `evaluated ${evaluated}/${signals.length} signals` };
};

async function markEvaluated(id, fields, headers) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/signal_microstructure_log?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify(fields),
    }
  );
  if (!res.ok) console.warn('[evaluate] PATCH failed for', id, await res.text());
}
