import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const stripe    = new Stripe(process.env.STRIPE_SECRET_KEY);

async function compileAllMetrics() {
  const today = new Date();
  const year  = new Date(Date.now() - 365 * 86400000).toISOString();
  const month = new Date(Date.now() - 30  * 86400000).toISOString();

  // Signups
  const { data: profiles } = await supabase.from('profiles').select('created_at, plan').gte('created_at', year);
  const signups = {
    today:   (profiles || []).filter(r => new Date(r.created_at) >= new Date(today.toDateString())).length,
    week:    (profiles || []).filter(r => new Date(r.created_at) >= new Date(Date.now() - 7*86400000)).length,
    month:   (profiles || []).filter(r => new Date(r.created_at) >= new Date(month)).length,
    year:    (profiles || []).length,
  };
  const planBreakdown = {};
  for (const r of profiles || []) {
    const p = r.plan || 'free';
    planBreakdown[p] = (planBreakdown[p] || 0) + 1;
  }

  // Revenue from Stripe
  let mrr = 0, arr = 0, activeSubscribers = 0, churnThisMonth = 0;
  try {
    const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
    activeSubscribers = subs.data.length;
    mrr = subs.data.reduce((s, sub) => {
      const item = sub.items.data[0];
      const amt  = item.price.unit_amount / 100;
      return s + (item.price.recurring?.interval === 'year' ? amt / 12 : amt);
    }, 0);
    arr = mrr * 12;
    const canceled = await stripe.subscriptions.list({ status: 'canceled', limit: 100,
      created: { gte: Math.floor(new Date(month).getTime() / 1000) } });
    churnThisMonth = canceled.data.length;
  } catch (e) { console.warn('stripe error', e.message); }

  // Telemetry
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const { count: eventsToday } = await supabase.from('app_telemetry')
    .select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString());

  // Agent performance
  const { data: agentPerf } = await supabase.from('agent_performance_daily')
    .select('*').gte('date', new Date(Date.now() - 7*86400000).toISOString().slice(0,10));

  return { signups, planBreakdown, mrr, arr, activeSubscribers, churnThisMonth,
           eventsToday: eventsToday || 0, agentPerf: agentPerf || [] };
}

export async function handler() {
  const today = new Date().toISOString().slice(0, 10);

  const metrics = await compileAllMetrics();

  let ai = {};
  try {
    const narrative = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: 'You are a business analyst for Tradolux, a trading platform. Given today\'s metrics, identify 3 opportunities and 3 marketing insights. Be specific and actionable. Use numbers from the data. Metrics: ' +
          JSON.stringify(metrics) +
          ' Return JSON: {"opportunities":[{"title":"...","description":"...","impact":"high|medium|low"}],"marketing":{"winning":[{"area":"...","detail":"..."}],"improving":[{"area":"...","detail":"..."}],"attention":[{"area":"...","detail":"..."}]}}'
      }]
    });
    ai = JSON.parse(narrative.content[0].text);
  } catch (e) { console.warn('AI narrative error', e.message); }

  const report = { ...metrics, ai, generated_at: new Date().toISOString() };

  await supabase.from('daily_report_cache').upsert({
    report_date: today,
    data: report,
    generated_at: new Date().toISOString()
  }, { onConflict: 'report_date' });

  return { statusCode: 200, body: 'report generated' };
}
