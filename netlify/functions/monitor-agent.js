/**
 * monitor-agent.js
 * Admin-only AI agent that reads all Monitor tab data from Supabase,
 * interprets it, and returns actionable advisory text.
 * Called from the Admin Dashboard → MONITOR section.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  // Verify admin token
  let userId;
  try {
    const authHeader = event.headers?.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) throw new Error('No token');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error('Invalid token');
    userId = user.id;

    const { data: profile } = await supabase
      .from('profiles')
      .select('admin')
      .eq('id', userId)
      .single();
    if (!profile?.admin) throw new Error('Not admin');
  } catch (e) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized: ' + e.message }) };
  }

  // ── Gather all Monitor data in parallel ──────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [
    monitorRunsResult,
    agentPerfResult,
    signalLogsResult,
    learnedWeightsResult,
    macroBriefResult,
    dailyReportResult,
    userCountResult,
    telemetryResult,
    alertsResult,
  ] = await Promise.allSettled([
    supabase.from('app_telemetry').select('*').eq('event_type', 'monitor_run').order('created_at', { ascending: false }).limit(5),
    supabase.from('agent_performance_daily').select('*').gte('trade_date', sevenDaysAgo).order('trade_date', { ascending: false }).limit(20),
    supabase.from('signal_microstructure_log').select('signal_direction,signal_outcome,hft_shield_score,created_at').gte('created_at', sevenDaysAgo + 'T00:00:00Z').limit(100),
    supabase.from('learned_weights').select('*').order('updated_at', { ascending: false }).limit(20),
    supabase.from('macro_daily_brief').select('macro_headline,macro_regime_score,execution_quality_today,generated_at,trading_date').order('trading_date', { ascending: false }).limit(3),
    supabase.from('daily_report_cache').select('report_date,ai_narrative,key_risks,key_supports').order('report_date', { ascending: false }).limit(1),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('app_telemetry').select('event_type,created_at').gte('created_at', sevenDaysAgo + 'T00:00:00Z').limit(200),
    supabase.from('alerts').select('symbol,alert_type,triggered_at').order('triggered_at', { ascending: false }).limit(10),
  ]);

  const extract = r => (r.status === 'fulfilled' ? r.value.data : null);
  const monitorRuns    = extract(monitorRunsResult) || [];
  const agentPerf      = extract(agentPerfResult) || [];
  const signalLogs     = extract(signalLogsResult) || [];
  const learnedWeights = extract(learnedWeightsResult) || [];
  const macroBriefs    = extract(macroBriefResult) || [];
  const dailyReport    = extract(dailyReportResult)?.[0] || null;
  const userCount      = userCountResult.status === 'fulfilled' ? (userCountResult.value.count || 0) : 0;
  const telemetry      = extract(telemetryResult) || [];
  const recentAlerts   = extract(alertsResult) || [];

  // Compute simple stats from telemetry
  const eventCounts = telemetry.reduce((acc, row) => {
    acc[row.event_type] = (acc[row.event_type] || 0) + 1;
    return acc;
  }, {});

  // Signal outcome stats
  const winSignals  = signalLogs.filter(s => s.signal_outcome === 'win').length;
  const lossSignals = signalLogs.filter(s => s.signal_outcome === 'loss').length;
  const totalSignals = signalLogs.length;
  const winRate = totalSignals > 0 ? Math.round((winSignals / totalSignals) * 100) : null;

  // Agent performance aggregated
  const agentMap = {};
  agentPerf.forEach(r => {
    if (!agentMap[r.agent_name]) agentMap[r.agent_name] = { wins: 0, losses: 0, total: 0 };
    agentMap[r.agent_name].wins   += r.wins_today || 0;
    agentMap[r.agent_name].losses += r.losses_today || 0;
    agentMap[r.agent_name].total  += (r.wins_today || 0) + (r.losses_today || 0);
  });

  // Build context summary
  const monitorContext = {
    platform_status: {
      last_monitor_run: monitorRuns[0]?.created_at || 'never',
      recent_alerts: monitorRuns.filter(r => (r.feature_name || '').includes('alert')).length,
      system_health: monitorRuns[0] ? (monitorRuns[0].feature_name?.includes('alert') ? 'degraded' : 'healthy') : 'unknown',
    },
    user_metrics: {
      total_users: userCount,
      active_sessions_7d: eventCounts['session_start'] || 0,
      signal_views_7d: eventCounts['signal_view'] || 0,
      watchlist_adds_7d: eventCounts['watchlist_add'] || 0,
      upgrade_clicks_7d: eventCounts['upgrade_click'] || 0,
    },
    signal_performance: {
      signals_7d: totalSignals,
      win_rate_pct: winRate,
      wins: winSignals,
      losses: lossSignals,
      avg_hft_score: totalSignals > 0
        ? Math.round(signalLogs.reduce((s, r) => s + (r.hft_shield_score || 0), 0) / totalSignals)
        : null,
    },
    agent_performance: Object.entries(agentMap).map(([name, s]) => ({
      agent: name,
      total_trades: s.total,
      win_rate_pct: s.total > 0 ? Math.round((s.wins / s.total) * 100) : null,
    })),
    learned_weights: learnedWeights.slice(0, 10).map(w => ({
      feature: w.feature_name,
      weight: w.weight_value,
      pending_approval: w.pending_approval,
    })),
    macro_intelligence: macroBriefs[0] ? {
      headline: macroBriefs[0].macro_headline,
      regime_score: macroBriefs[0].macro_regime_score,
      execution_quality: macroBriefs[0].execution_quality_today,
      as_of: macroBriefs[0].trading_date,
    } : null,
    daily_report: dailyReport ? {
      date: dailyReport.report_date,
      risks: dailyReport.key_risks,
      supports: dailyReport.key_supports,
    } : null,
    recent_alerts: recentAlerts.slice(0, 5).map(a => ({
      symbol: a.symbol,
      type: a.alert_type,
      at: a.triggered_at,
    })),
    data_availability: {
      signal_logs_populated: signalLogs.length > 0,
      agent_perf_populated: agentPerf.length > 0,
      learned_weights_populated: learnedWeights.length > 0,
      macro_brief_populated: macroBriefs.length > 0,
      daily_report_populated: !!dailyReport,
    },
  };

  // ── Call Claude for analysis ──────────────────────────────────────────────────
  const prompt = `You are the Tradolux platform AI advisor. Review this real-time platform data and provide a concise, structured analysis for the admin.

DATA:
${JSON.stringify(monitorContext, null, 2)}

Provide analysis in this exact JSON format:
{
  "health_score": <0-100 integer>,
  "health_label": "<HEALTHY|DEGRADED|CRITICAL>",
  "summary": "<2-3 sentence overview of platform status>",
  "insights": [
    {"type": "<positive|warning|critical>", "title": "<short title>", "detail": "<1-2 sentences>"},
    ...3-5 insights...
  ],
  "recommendations": [
    {"priority": "<HIGH|MEDIUM|LOW>", "action": "<specific actionable step>"},
    ...3-4 recommendations...
  ],
  "data_gaps": [
    "<description of missing data that limits analysis, if any>"
  ]
}

Be specific about numbers. If data tables are empty (signal_logs, agent_perf, etc.), flag this as a critical setup issue. Focus on what's actionable.`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    const rawText = aiData.content?.[0]?.text || '{}';

    let analysis;
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      analysis = match ? JSON.parse(match[0]) : { summary: rawText };
    } catch {
      analysis = { summary: rawText };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        analysis,
        raw_data: monitorContext,
        generated_at: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'AI analysis failed', details: err.message }),
    };
  }
}
