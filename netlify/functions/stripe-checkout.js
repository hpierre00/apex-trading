// stripe-checkout.js — uses Stripe REST API directly, no npm dependency needed

const SUPABASE_URL      = 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';

const VALID_PRICE_IDS = new Set([
  'price_1TUAErRAfobZUNrF4Wj4cOgy', // Starter monthly
  'price_1TUAExRAfobZUNrFpRWN4SUP', // Starter annual
  'price_1TU4wlRAfobZUNrFPmVgeONk', // Pro monthly
  'price_1TU4wpRAfobZUNrFa6We3bUb', // Pro annual
  'price_1TU4wuRAfobZUNrF7AhIbytY', // Elite monthly
  'price_1TU4wzRAfobZUNrFENR9U7XR', // Elite annual
]);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function err(msg, code = 400) {
  return { statusCode: code, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  // Verify Supabase JWT
  const token = (event.headers['authorization'] || event.headers['Authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return err('Unauthorized', 401);

  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  if (!authCheck.ok) return err('Unauthorized', 401);
  const user = await authCheck.json();

  // Validate body
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON'); }
  const { priceId } = body;
  if (!priceId || !VALID_PRICE_IDS.has(priceId)) return err('Invalid price');

  const stripeKey = process.env.STRIPE_SECRET;
  if (!stripeKey) return err('Stripe not configured', 500);

  // Call Stripe REST API directly — no npm package needed
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('subscription_data[trial_period_days]', '14');
  params.append('customer_email', user.email || '');
  params.append('success_url', 'https://tradolux.com/app?upgraded=1');
  params.append('cancel_url', 'https://tradolux.com/app');

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok || !session.url) {
    console.error('[stripe-checkout] Stripe error:', JSON.stringify(session));
    return err('Stripe error: ' + (session.error?.message || 'Unknown'), 502);
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};
