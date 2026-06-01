import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TF_MINUTES = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '4h': 240, '1d': 1440, '1w': 10080
};

export async function handler(event) {
  const now = new Date();

  const { data: signals } = await supabase
    .from('signal_microstructure_log')
    .select('*')
    .eq('is_evaluated', false)
    .not('eval_after_ts', 'is', null)
    .lte('eval_after_ts', now.toISOString())
    .limit(100);

  if (!signals?.length) return { statusCode: 200, body: 'nothing to evaluate' };

  for (const sig of signals) {
    try {
      const tfMins = TF_MINUTES[sig.timeframe] || 5;

      const from = new Date(sig.created_at);
      const to   = new Date(sig.eval_after_ts);
      const url  = 'https://api.polygon.io/v2/aggs/ticker/' + sig.symbol + '/range/' + tfMins + '/minute/' +
                   from.toISOString().slice(0,10) + '/' + to.toISOString().slice(0,10) +
                   '?apiKey=' + process.env.POLYGON_API_KEY + '&limit=50&sort=asc';

      const resp = await fetch(url);
      const json = await resp.json();
      const bars = json.results || [];

      if (!bars.length) continue;

      const entry = sig.entry_price || bars[0].o;
      const direction = sig.signal_type === 'BUY' ? 1 : -1;
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

      const pnlPct = ((exitPrice - entry) / entry) * direction * 100;
      const riskPct = Math.abs((stop - entry) / entry * 100);
      const rr = riskPct > 0 ? (pnlPct / riskPct) : 0;
      const directionCorrect = pnlPct > 0 ? 'correct' : pnlPct < -0.05 ? 'incorrect' : 'neutral';

      await supabase
        .from('signal_microstructure_log')
        .update({
          is_evaluated:         true,
          outcome_direction:    directionCorrect,
          outcome_hit_target:   hitTarget,
          outcome_hit_stop:     hitStop,
          outcome_exit_price:   exitPrice,
          outcome_pnl_pct:      pnlPct,
          outcome_rr:           rr,
          outcome_evaluated_at: now.toISOString()
        })
        .eq('id', sig.id);

    } catch (err) {
      console.error('evaluate error for signal', sig.id, err.message);
    }
  }

  return { statusCode: 200, body: 'evaluated ' + signals.length + ' signals' };
}
