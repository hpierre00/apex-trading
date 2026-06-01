import Stripe from 'stripe';
export async function handler(event) {
  const auth = event.headers.authorization;
  if (!auth) return { statusCode: 401, body: 'Unauthorized' };
  if (!process.env.STRIPE_SECRET_KEY) return { statusCode: 500, body: 'STRIPE_SECRET_KEY not configured' };
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const periods = {
      today: todayMidnight, week: new Date(now - 7*86400000),
      month: new Date(now - 30*86400000), quarter: new Date(now - 90*86400000),
      year: new Date(now - 365*86400000),
    };
    const charges = await stripe.charges.list({ limit: 100, created: { gte: Math.floor(periods.year.getTime()/1000) } });
    function sumRevenue(since) {
      return charges.data.filter(c => c.status==='succeeded' && c.created*1000>=since.getTime())
        .reduce((s,c) => s+c.amount/100, 0);
    }
    const revMap = {};
    for (let i=29; i>=0; i--) { const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10); revMap[d]=0; }
    for (const c of charges.data) {
      if (c.status!=='succeeded') continue;
      const d=new Date(c.created*1000).toISOString().slice(0,10);
      if (d in revMap) revMap[d]+=c.amount/100;
    }
    const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
    const mrr = subs.data.reduce((s,sub) => {
      const item=sub.items.data[0]; const amount=(item.price.unit_amount||0)/100;
      return s+(item.price.recurring?.interval==='year' ? amount/12 : amount);
    }, 0);
    const customers = await stripe.customers.list({ limit: 100, created: { gte: Math.floor(periods.year.getTime()/1000) } });
    function countNew(since) { return customers.data.filter(c=>c.created*1000>=since.getTime()).length; }
    const canceled = await stripe.subscriptions.list({ status: 'canceled', limit: 100, created: { gte: Math.floor(periods.month.getTime()/1000) } });
    const planBreakdown = {};
    for (const sub of subs.data) { const n=sub.items.data[0].price.nickname||'unknown'; planBreakdown[n]=(planBreakdown[n]||0)+1; }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        revenue: { today: sumRevenue(periods.today), week: sumRevenue(periods.week), month: sumRevenue(periods.month), quarter: sumRevenue(periods.quarter), year: sumRevenue(periods.year) },
        mrr, arr: mrr*12,
        newCustomers: { today: countNew(periods.today), week: countNew(periods.week), month: countNew(periods.month), quarter: countNew(periods.quarter), year: countNew(periods.year) },
        churnThisMonth: canceled.data.length, activeSubscribers: subs.data.length, planBreakdown,
        revenueByDay: Object.entries(revMap).sort(([a],[b])=>a.localeCompare(b)).map(([d,v])=>({d,v})),
      })
    };
  } catch (err) { return { statusCode: 500, body: err.message }; }
}
