import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APPROVAL_THRESHOLD = 0.20;

const agents = ['momentum', 'macro', 'microstructure', 'contrarian', 'composite'];

async function computeAndStoreAgentPerformance() {
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
}

export async function handler() {
  const { data: outcomes } = await supabase
    .from('signal_microstructure_log')
    .select('condition_key, outcome_direction, outcome_hit_target, hft_score')
    .eq('is_evaluated', true)
    .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString())
    .not('condition_key', 'is', null);

  const groups = {};
  for (const row of outcomes || []) {
    const key = row.condition_key;
    if (!groups[key]) groups[key] = { correct: 0, total: 0, targetHits: 0 };
    groups[key].total++;
    if (row.outcome_direction === 'correct') groups[key].correct++;
    if (row.outcome_hit_target) groups[key].targetHits++;
  }

  for (const [key, stats] of Object.entries(groups)) {
    if (stats.total < 10) continue;

    const accuracy = stats.correct / stats.total;
    const newWeight = Math.max(0.1, Math.min(3.0, accuracy / 0.5));

    const { data: existing } = await supabase
      .from('learned_weights')
      .select('weight_multiplier, accuracy_rate')
      .eq('condition_key', key)
      .single();

    const oldWeight = existing?.weight_multiplier || 1.0;
    const changePct = Math.abs((newWeight - oldWeight) / oldWeight);

    const explanation = 'Accuracy: ' + (accuracy * 100).toFixed(1) + '% over ' + stats.total + ' signals. ' +
                        'Target hit rate: ' + (stats.targetHits / stats.total * 100).toFixed(1) + '%.';

    if (changePct < APPROVAL_THRESHOLD) {
      await supabase.from('learned_weights').upsert({
        condition_key: key,
        weight_multiplier: newWeight,
        accuracy_rate: accuracy,
        sample_size: stats.total,
        explanation,
        approved: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'condition_key' });
    } else {
      await supabase.from('learned_weights').upsert({
        condition_key: key,
        pending_weight: newWeight,
        pending_accuracy: accuracy,
        pending_samples: stats.total,
        pending_explanation: explanation,
        pending_created_at: new Date().toISOString()
      }, { onConflict: 'condition_key' });
    }
  }

  await computeAndStoreAgentPerformance();

  return { statusCode: 200, body: 'weights updated' };
}
