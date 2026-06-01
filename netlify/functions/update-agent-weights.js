import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPROVAL_THRESHOLD = 0.20;

export async function handler() {
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: outcomes, error } = await supabase
    .from('signal_microstructure_log')
    .select('condition_key, outcome_direction, outcome_hit_target, agent_name')
    .eq('is_evaluated', true)
    .gte('created_at', since90)
    .not('condition_key', 'is', null);
  if (error) return { statusCode: 500, body: error.message };

  const groups = {};
  for (const row of (outcomes || [])) {
    const key = row.condition_key;
    if (!groups[key]) groups[key] = { correct: 0, total: 0, targetHits: 0 };
    groups[key].total++;
    if (row.outcome_direction === 'correct') groups[key].correct++;
    if (row.outcome_hit_target) groups[key].targetHits++;
  }

  let autoApplied = 0, queued = 0;
  for (const [key, stats] of Object.entries(groups)) {
    if (stats.total < 10) continue;
    const accuracy = stats.correct / stats.total;
    const newWeight = Math.max(0.1, Math.min(3.0, accuracy / 0.5));
    const { data: existing } = await supabase.from('learned_weights')
      .select('weight_multiplier').eq('condition_key', key).maybeSingle();
    const oldWeight = existing?.weight_multiplier || 1.0;
    const changePct = Math.abs((newWeight - oldWeight) / oldWeight);
    const explanation = `Accuracy: ${(accuracy*100).toFixed(1)}% over ${stats.total} signals. Target hit rate: ${(stats.targetHits/stats.total*100).toFixed(1)}%.`;
    if (changePct < APPROVAL_THRESHOLD) {
      await supabase.from('learned_weights').upsert({
        condition_key: key, weight_multiplier: newWeight, accuracy_rate: accuracy,
        sample_size: stats.total, explanation, approved: true, updated_at: new Date().toISOString()
      }, { onConflict: 'condition_key' });
      autoApplied++;
    } else {
      await supabase.from('learned_weights').upsert({
        condition_key: key, pending_weight: newWeight, pending_accuracy: accuracy,
        pending_samples: stats.total, pending_explanation: explanation,
        pending_created_at: new Date().toISOString()
      }, { onConflict: 'condition_key' });
      queued++;
    }
  }

  // compute agent performance
  const agents = ['momentum', 'macro', 'microstructure', 'contrarian', 'composite'];
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  for (const agent of agents) {
    const { data } = await supabase.from('signal_microstructure_log')
      .select('outcome_direction, outcome_hit_target, outcome_rr, outcome_pnl_pct, condition_key')
      .eq('agent_name', agent).eq('is_evaluated', true).gte('created_at', since);
    if (!data?.length) continue;
    const total = data.length;
    const correct = data.filter(r => r.outcome_direction === 'correct').length;
    const targetHits = data.filter(r => r.outcome_hit_target).length;
    const avgRR = data.reduce((s, r) => s + (r.outcome_rr || 0), 0) / total;
    const avgPnl = data.reduce((s, r) => s + (r.outcome_pnl_pct || 0), 0) / total;
    const condMap = {};
    for (const r of data) {
      if (!r.condition_key) continue;
      if (!condMap[r.condition_key]) condMap[r.condition_key] = { correct: 0, total: 0 };
      condMap[r.condition_key].total++;
      if (r.outcome_direction === 'correct') condMap[r.condition_key].correct++;
    }
    const condRates = Object.entries(condMap).filter(([,v]) => v.total >= 3)
      .map(([k,v]) => ({ k, rate: v.correct/v.total })).sort((a,b) => b.rate - a.rate);
    await supabase.from('agent_performance_daily').upsert({
      agent_name: agent, date: today, signals_count: total,
      direction_win_rate: correct/total, rr_win_rate: targetHits/total,
      avg_rr: avgRR, avg_pnl_pct: avgPnl,
      best_condition: condRates[0]?.k || null,
      worst_condition: condRates[condRates.length-1]?.k || null,
    }, { onConflict: 'agent_name,date' });
  }

  return { statusCode: 200, body: `weights updated: ${autoApplied} auto-applied, ${queued} queued` };
}
