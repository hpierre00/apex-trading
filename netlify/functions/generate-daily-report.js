import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import Stripe from 'stripe';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function compileAllMetrics() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const periods = {
    today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    week: new Date(now - 7 * 86400000),
    month: new Date(now - 30 * 86400000),
    quarter: new Date(now - 90 * 86400000),
    year: new Date(now - 365 * 86400000),
  };

  // Signups
  const { data: profiles } = await supabase.from('profiles').select('created_at,plan').gte('created_at', periods.year.toISOString());
  const signups = {};
  for (const [k, since] of Object.entries(periods)) {
    signups[k] = (profiles || []).filter(r => new Date(r.created_at) >= since).length;
  }
  const planBreakdown = {};
  for (const r of (profiles || [])) { const p = r.plan || 'free'; planBreakdown[p] = (planBreakdown[p] || 0) + 1; }

  // Telemetry
  const { count: eventsToday } = await supabase.from('app_telemetry').select('id', { count: 'exact', head: true }).gte('created_at', periods.today.toISOString());
  const { count: eventsWeek } = await supabase.from('app_telemetry').select('id', { count: 'exact', head: true }).gte('created_at', periods.week.toISOString());
  const { count: errorsToday } = await supabase.from('app_telemetry').select('id', { count: 'exact', head: true }).gte('created_at', periods.today.toISOString()).eq('event_type', 'error');

  // Signals
  const { count: signalsToday } = await supabase.from('signal_microstructure_log').select('id', { count: 'exact', head: true }).gte('created_at', periods.today.toISOString());
  const { count: signalsWeek } = await supabase.from('signal_microstructure_log').select('id', { count: 'exact', head: true }).gte('created_at', periods.week.toISOString());
  const { count: pendingEvals } = await supabase.from('signal_microstructure_log').select('id', { count: 'exact', head: true }).eq('is_evaluated', false).not('eval_after_ts', 'is', null);

  // Agent performance
  const { data: agentPerf } = await supabase.from('agent_performance_daily').select('*').gte('date', periods.week.toISOString().slice(0, 10)).order('date', { ascending: false });

  // Usage
  const { data: usageData } = await supabase.from('app_telemetry').select('page_section,duration_ms').gte('created_at', periods.month.toISOString()).not('page_section', 'is', null);
  const usageTotals = {};
  for (const r of (usageData || [])) usageTotals[r.page_section] = (usageTotals[r.page_section] || 0) + (r.duration_ms || 1000);
  const grandTotal = Object.values(usageTotals).reduce((a, b) => a + b, 0) || 1;
  const usage = Object.entries(usageTotals).sort((a, b) => b[1] - a[1]).map(([section, ms]) => ({ section, pct: ms / grandTotal * 100 }));

  // Revenue via Stripe
  let revenue = {}, mrr = 0, arr = 0, activeSubscribers = 0, churnThisMonth = 0, newCustomers = {}, revenueByDay = [];
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const charges = await stripe.charges.list({ limit: 100, created: { gte: Math.floor(periods.year.getTime() / 1000) } });
      function sumRev(since) { return charges.data.filter(c => c.status === 'succeeded' && c.created * 1000 >= since.getTime()).reduce((s, c) => s + c.amount / 100, 0); }
      revenue = { today: sumRev(periods.today), week: sumRev(periods.week), month: sumRev(periods.month), quarter: sumRev(periods.quarter), year: sumRev(periods.year) };
      const revMap = {};
      for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); revMap[d] = 0; }
      for (const c of charges.data) { if (c.status !== 'succeeded') continue; const d = new Date(c.created * 1000).toISOString().slice(0, 10); if (d in revMap) revMap[d] += c.amount / 100; }
      revenueByDay = Object.entries(revMap).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, v }));
      const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
      mrr = subs.data.reduce((s, sub) => { const item = sub.items.data[0]; const amount = (item.price.unit_amount || 0) / 100; return s + (item.price.recurring?.interval === 'year' ? amount / 12 : amount); }, 0);
      arr = mrr * 12;
      activeSubscribers = subs.data.length;
      const canceled = await stripe.subscriptions.list({ status: 'canceled', limit: 100, created: { gte: Math.floor(periods.month.getTime() / 1000) } });
      churnThisMonth = canceled.data.length;
      const customers = await stripe.customers.list({ limit: 100, created: { gte: Math.floor(periods.year.getTime() / 1000) } });
      function countNew(since) { return customers.data.filter(c => c.created * 1000 >= since.getTime()).length; }
      newCustomers = { today: countNew(periods.today), week: countNew(periods.week), month: countNew(periods.month), quarter: countNew(periods.quarter), year: countNew(periods.year) };
    } catch (e) { console.warn('Stripe error:', e.message); }
  }

  return {
    date: today, signups, planBreakdown, usage,
    telemetry: { eventsToday: eventsToday || 0, eventsWeek: eventsWeek || 0, errorsToday: errorsToday || 0, errorRate: (eventsToday || 0) > 0 ? ((errorsToday || 0) / eventsToday * 100).toFixed(1) : '0.0' },
    signals: { signalsToday: signalsToday || 0, signalsWeek: signalsWeek || 0, pendingEvals: pendingEvals || 0 },
    agentPerf: agentPerf || [],
    revenue, mrr, arr, activeSubscribers, churnThisMonth, newCustomers, revenueByDay,
  };
}

export async function handler() {
  try {
    const metrics = await compileAllMetrics();

    // Generate AI narrative
    let ai = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const prompt = `You are a business intelligence analyst. Given these metrics for an AI-powered trading signals SaaS, produce a JSON analysis.

METRICS:
- Revenue today: $${metrics.revenue?.today?.toFixed(2) || 0}
- MRR: $${metrics.mrr?.toFixed(2) || 0}
- ARR: $${metrics.arr?.toFixed(2) || 0}
- Active subscribers: ${metrics.activeSubscribers}
- Churn this month: ${metrics.churnThisMonth}
- Signups today/week/month: ${metrics.signups?.today}/${metrics.signups?.week}/${metrics.signups?.month}
- Signals generated today/week: ${metrics.signals?.signalsToday}/${metrics.signals?.signalsWeek}
- Pending signal evaluations: ${metrics.signals?.pendingEvals}
- Top usage section: ${metrics.usage?.[0]?.section || 'unknown'} (${metrics.usage?.[0]?.pct?.toFixed(1) || 0}%)
- Plan breakdown: ${JSON.stringify(metrics.planBreakdown)}
- Error rate today: ${metrics.telemetry?.errorRate}%

Return ONLY valid JSON with this structure:
{
  "summary": "2-sentence executive summary",
  "opportunities": [{"title":"...","description":"...","impact":"high|medium|low"}],
  "marketing": {
    "winning": [{"area":"...","detail":"..."}],
    "improving": [{"area":"...","detail":"..."}],
    "attention": [{"area":"...","detail":"..."}]
  },
  "risks": [{"area":"...","detail":"...","severity":"high|medium|low"}]
}`;

        const msg = await client.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }]
        });
        const text = msg.content[0]?.text || '{}';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) ai = JSON.parse(jsonMatch[0]);
      } catch (e) { console.warn('AI narrative error:', e.message); }
    }

    const reportData = { ...metrics, ai };

    // Upsert to cache
    await supabase.from('daily_report_cache').upsert({
      report_date: metrics.date,
      data: reportData,
      generated_at: new Date().toISOString()
    }, { onConflict: 'report_date' });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, date: metrics.date, summary: ai?.summary || 'Report generated.' })
    };
  } catch (err) {
    console.error('generate-daily-report error:', err);
    return { statusCode: 500, body: err.message };
  }
}
