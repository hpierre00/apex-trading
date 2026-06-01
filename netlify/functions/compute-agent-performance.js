import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const agents = ['momentum', 'macro', 'microstructure', 'contrarian', 'composite'];

export async function handler() {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  for (const agent of agents) {
    const { data } = await supabase
      .from('signal_microstructure_log')
      .select('outcome_direction, outcome_hit_target, outcome_rr, outcome_pnl_pct, condition_key')
      .eq('agent_name', agent)
      .eq('is_evaluated', true)
      .gte('created_at', since);

    if (!data?.length) continue;

    const total = data.length;
    const correct = data.filter(r => r.outcome_direction === 'correct').length;
    const targetHits = data.filter(r => r.outcome_hit_target).length;
    const avgRR = data.reduce((s, r) => s + (r.outcome_rr || 0), 0) / total;
    const avgPnl = data.reduce((s, r) => s + (r.outcome_pnl_pct || 0), 0) / total;

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

    await supabase.from('agent_performance_daily').upsert({
      agent_name:         agent,
      date:               today,
      signals_count:      total,
      direction_win_rate: correct / total,
      rr_win_rate:        targetHits / total,
      avg_rr:             avgRR,
      avg_pnl_pct:        avgPnl,
      best_condition:     condRates[0]?.k || null,
      worst_condition:    condRates[condRates.length - 1]?.k || null,
    }, { onConflict: 'agent_name,date' });
  }

  return { statusCode: 200, body: 'agent performance computed' };
}
