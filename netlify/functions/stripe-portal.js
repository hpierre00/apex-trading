// stripe-portal.js — opens the Stripe customer portal so users can cancel / manage their subscription
// Uses Stripe REST API directly, no npm dependency needed

const SUPABASE_URL      = 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';

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

  const stripeKey = process.env.STRIPE_SECRET;
  if (!stripeKey) return err('Stripe not configured', 500);
  const stripeAuth = { 'Authorization': `Bearer ${stripeKey}` };

  // Customer ID is written to profiles by stripe-webhook.js on checkout
  let customerId = null;
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=stripe_customer_id`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (profRes.ok) customerId = (await profRes.json())[0]?.stripe_customer_id || null;

  // Fallback: look the customer up by email (covers profiles the webhook didn't update)
  if (!customerId && user.email) {
    const r = await fetch(`https://api.stripe.com/v1/customers?limit=1&email=${encodeURIComponent(user.email)}`, { headers: stripeAuth });
    const list = await r.json();
    customerId = list.data?.[0]?.id || null;
  }
  if (!customerId) return err('No subscription found for this account', 404);

  const params = new URLSearchParams();
  params.append('customer', customerId);
  params.append('return_url', 'https://tradolux.com/app');

  const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { ...stripeAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok || !session.url) {
    console.error('[stripe-portal] Stripe error:', JSON.stringify(session));
    return err('Stripe error: ' + (session.error?.message || 'Unknown'), 502);
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};
